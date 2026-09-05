<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SupportTicket;
use App\Models\SupportTicketAttachment;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\Mailer;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Support tickets, from both ends.
 *
 * One controller for the person raising a concern and the administrator
 * resolving it, because they are acting on the same record and splitting them
 * would mean two implementations of "what does this ticket look like now" —
 * free to disagree, and they would.
 *
 * What separates the two audiences is `scope()`: an administrator's query is
 * every ticket, everybody else's is their own. That method is the access
 * control for this whole file, so nothing below it re-derives who may see
 * what. The one other asymmetry is internal notes, which are stripped for the
 * raiser in `thread()` — an administrator's working note about a ticket is not
 * part of the reply.
 */
class SupportController extends Controller
{
    /** Anything older than this without a reply is flagged as ageing. */
    private const STALE_HOURS = 48;

    public function __construct(
        private readonly Mailer $mailer,
        private readonly Settings $settings,
        private readonly AuditLogger $audit,
    ) {}

    /* ================================ Reading =============================== */

    public function index(Request $request): JsonResponse
    {
        $admin = $this->isAdmin($request);

        $tickets = $this->scope($request)
            ->when($request->string('status')->toString(), fn ($q, $s) => $q->where('status', $s))
            ->when($request->boolean('openOnly'), fn ($q) => $q->whereNotIn('status', ['Resolved', 'Closed']))
            ->with(['raiser:id,name,employee_id', 'raiser.employee:id,employee_no', 'assignee:id,name'])
            ->withCount(['messages', 'attachments'])
            // Urgency first, then whichever conversation has gone quiet
            // longest — a queue ordered by created date buries the ticket
            // somebody has been waiting a week on.
            ->orderByRaw("FIELD(status,'Open','Waiting on you','In progress','Resolved','Closed')")
            ->orderByRaw("FIELD(priority,'Urgent','High','Normal','Low')")
            ->orderByRaw('COALESCE(last_activity_at, created_at) asc')
            ->limit(500)
            ->get();

        return response()->json(['data' => [
            'isAdmin' => $admin,
            'tickets' => $tickets->map(fn (SupportTicket $t) => $this->card($t))->all(),
            'counts' => $this->counts($request),
        ]]);
    }

    public function show(Request $request, SupportTicket $ticket): JsonResponse
    {
        $this->assertVisible($request, $ticket);

        $ticket->load([
            'raiser:id,name,email,employee_id', 'raiser.employee:id,employee_no,mobile',
            'raiser.employee.hrDepartment:id,name',
            'assignee:id,name', 'resolver:id,name',
            'messages.user:id,name', 'messages.attachments',
            'attachments.uploader:id,name',
        ]);

        $admin = $this->isAdmin($request);

        return response()->json(['data' => [
            'id' => $ticket->id,
            'reference' => $ticket->reference,
            'subject' => $ticket->subject,
            'body' => $ticket->body,
            'category' => $ticket->category,
            'priority' => $ticket->priority,
            'status' => $ticket->status,
            'raisedBy' => $ticket->raiser?->name,
            'raisedById' => $ticket->raised_by,
            'raiserEmployeeNo' => $ticket->raiser?->employee?->employee_no,
            'raiserDepartment' => $ticket->raiser?->employee?->hrDepartment?->name,
            // Only the administrator needs a way to phone somebody back.
            'raiserMobile' => $admin ? $ticket->raiser?->employee?->mobile : null,
            'raiserEmail' => $admin ? $ticket->raiser?->email : null,
            'assignedTo' => $ticket->assignee?->name,
            'assignedToId' => $ticket->assigned_to,
            'resolution' => $ticket->resolution,
            'resolvedBy' => $ticket->resolver?->name,
            'resolvedAt' => $ticket->resolved_at?->toIso8601String(),
            'closedAt' => $ticket->closed_at?->toIso8601String(),
            'satisfaction' => $ticket->satisfaction,
            'createdAt' => $ticket->created_at?->toIso8601String(),
            'lastActivityAt' => $ticket->last_activity_at?->toIso8601String(),
            'idleHours' => $ticket->idleHours(),
            'isOpen' => $ticket->isOpen(),
            'canAdminister' => $admin,
            'messages' => $this->thread($ticket, $admin),
            'attachments' => $ticket->attachments->whereNull('message_id')->map(fn ($a) => $this->file($a))->values()->all(),
        ]]);
    }

    /**
     * The conversation, with internal notes removed for the raiser.
     *
     * Filtered here rather than in the query so there is exactly one place
     * that decides it — a second `where('internal', false)` somewhere else is
     * how a note eventually reaches the person it was written about.
     */
    private function thread(SupportTicket $ticket, bool $admin): array
    {
        return $ticket->messages
            ->filter(fn ($m) => $admin || ! $m->internal)
            ->map(fn ($m) => [
                'id' => $m->id,
                'body' => $m->body,
                'author' => $m->user?->name,
                'authorId' => $m->user_id,
                'internal' => $m->internal,
                'fromStaff' => $m->user_id !== $ticket->raised_by,
                'createdAt' => $m->created_at?->toIso8601String(),
                'attachments' => $m->attachments->map(fn ($a) => $this->file($a))->values()->all(),
            ])
            ->values()
            ->all();
    }

    /* ================================ Raising =============================== */

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'subject' => 'required|string|max:200',
            'body' => 'required|string|max:8000',
            'category' => 'nullable|in:Access,Payroll,Attendance,System fault,Data correction,Equipment,Request,Other',
            'priority' => 'nullable|in:Low,Normal,High,Urgent',
        ]);

        $user = $request->user();

        $ticket = DB::transaction(function () use ($data, $user) {
            $ticket = SupportTicket::create($data + [
                'reference' => $this->nextReference(),
                'raised_by' => $user->id,
                'status' => 'Open',
                'last_activity_at' => now(),
            ]);

            $this->audit->log('raised a support ticket', 'SupportTicket', $ticket->id, $ticket->reference, 'support');

            return $ticket;
        });

        // Tell the people who can actually act on it. Failure to email must
        // not lose the ticket — it is already saved by this point.
        $this->notifyAdmins($ticket, $user);

        return response()->json(['data' => ['id' => $ticket->id, 'reference' => $ticket->reference]], 201);
    }

    private function nextReference(): string
    {
        $stem = 'TKT-'.date('Y').'-';
        $last = SupportTicket::withTrashed()->where('reference', 'like', $stem.'%')->orderByDesc('reference')->value('reference');
        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }

    /* =============================== Replying =============================== */

    public function reply(Request $request, SupportTicket $ticket): JsonResponse
    {
        $this->assertVisible($request, $ticket);

        $data = $request->validate([
            'body' => 'required|string|max:8000',
            'internal' => 'nullable|boolean',
        ]);

        $admin = $this->isAdmin($request);
        $internal = $admin && (bool) ($data['internal'] ?? false);

        $message = DB::transaction(function () use ($ticket, $data, $request, $admin, $internal) {
            $message = $ticket->messages()->create([
                'user_id' => $request->user()->id,
                'body' => $data['body'],
                'internal' => $internal,
            ]);

            $update = ['last_activity_at' => now()];

            // A note to self does not move the ticket; a real reply does.
            if (! $internal) {
                if ($admin && $ticket->status === 'Open') {
                    $update['status'] = 'In progress';
                } elseif (! $admin && $ticket->status === 'Waiting on you') {
                    // The raiser answered the question that was blocking it.
                    $update['status'] = 'In progress';
                }
            }

            $ticket->update($update);

            return $message;
        });

        if (! $internal) {
            $this->notifyReply($ticket, $request->user(), $data['body'], $admin);
        }

        return response()->json(['data' => ['id' => $message->id]], 201);
    }

    /* ============================ Administration ============================ */

    /**
     * Status, priority and assignment — administrators only.
     *
     * Separate from `reply` because changing a ticket's state and saying
     * something about it are different acts, and a screen that only lets you
     * do them together produces either silent status changes or empty replies.
     */
    public function update(Request $request, SupportTicket $ticket): JsonResponse
    {
        abort_unless($this->isAdmin($request), 403, 'Only an administrator can change a ticket.');

        $data = $request->validate([
            'status' => 'sometimes|in:Open,In progress,Waiting on you,Resolved,Closed',
            'priority' => 'sometimes|in:Low,Normal,High,Urgent',
            'category' => 'sometimes|in:Access,Payroll,Attendance,System fault,Data correction,Equipment,Request,Other',
            'assigned_to' => 'nullable|integer|exists:users,id',
        ]);

        $ticket->update($data + ['last_activity_at' => now()]);

        $this->audit->log('updated a support ticket', 'SupportTicket', $ticket->id, $ticket->reference, 'support');

        return response()->json(['data' => ['id' => $ticket->id]]);
    }

    /** Marks it fixed, with what was done — and tells the person who asked. */
    public function resolve(Request $request, SupportTicket $ticket): JsonResponse
    {
        abort_unless($this->isAdmin($request), 403, 'Only an administrator can resolve a ticket.');

        $data = $request->validate(['resolution' => 'required|string|max:4000']);

        $ticket->update([
            'status' => 'Resolved',
            'resolution' => $data['resolution'],
            'resolved_at' => now(),
            'resolved_by' => $request->user()->id,
            'last_activity_at' => now(),
        ]);

        // The resolution is part of the conversation, not a field nobody reads.
        $ticket->messages()->create([
            'user_id' => $request->user()->id,
            'body' => $data['resolution'],
            'internal' => false,
        ]);

        $this->audit->log('resolved a support ticket', 'SupportTicket', $ticket->id, $ticket->reference, 'support');
        $this->notifyResolved($ticket, $request->user());

        return response()->json(['data' => ['id' => $ticket->id]]);
    }

    /**
     * Closing, by either side.
     *
     * The raiser closes their own ticket when they are satisfied; an
     * administrator can close one that has gone quiet. Reopening is a status
     * change, which is why it is not a separate endpoint.
     */
    public function close(Request $request, SupportTicket $ticket): JsonResponse
    {
        $this->assertVisible($request, $ticket);

        $data = $request->validate([
            'satisfaction' => 'nullable|integer|min:1|max:5',
        ]);

        $ticket->update([
            'status' => 'Closed',
            'closed_at' => now(),
            'last_activity_at' => now(),
        ] + (isset($data['satisfaction']) ? ['satisfaction' => $data['satisfaction']] : []));

        return response()->json(['data' => ['id' => $ticket->id]]);
    }

    public function reopen(Request $request, SupportTicket $ticket): JsonResponse
    {
        $this->assertVisible($request, $ticket);

        $ticket->update([
            'status' => 'Open',
            'closed_at' => null,
            'resolved_at' => null,
            'last_activity_at' => now(),
        ]);

        return response()->json(['data' => ['id' => $ticket->id]]);
    }

    /* ============================== Attachments ============================= */

    public function attach(Request $request, SupportTicket $ticket): JsonResponse
    {
        $this->assertVisible($request, $ticket);

        $request->validate([
            'files' => 'required|array|max:6',
            'files.*' => ['file', 'max:20480', 'mimes:jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,csv,txt,zip'],
            'message_id' => 'nullable|integer|exists:support_ticket_messages,id',
        ]);

        $saved = [];
        foreach ($request->file('files') as $file) {
            $saved[] = $this->file($this->storeFile($ticket, $file, $request->user(), $request->integer('message_id') ?: null));
        }

        $ticket->update(['last_activity_at' => now()]);

        return response()->json(['data' => $saved], 201);
    }

    private function storeFile(SupportTicket $ticket, UploadedFile $file, User $actor, ?int $messageId): SupportTicketAttachment
    {
        $path = $file->store("tickets/{$ticket->id}", 'public');

        $width = null;
        $height = null;

        if (str_starts_with((string) $file->getMimeType(), 'image/')) {
            $size = @getimagesize($file->getRealPath() ?: '');
            if ($size) {
                [$width, $height] = $size;
            }
        }

        return $ticket->attachments()->create([
            'message_id' => $messageId,
            'uploaded_by' => $actor->id,
            'disk' => 'public',
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'size_bytes' => $file->getSize(),
            'width' => $width,
            'height' => $height,
        ]);
    }

    /* ================================ Access ================================ */

    /**
     * Whether this account administers tickets.
     *
     * The super administrator, because that is who the request named. Kept as
     * a method rather than inlined so that widening it later — to an IT role,
     * say — is one edit in one place.
     */
    private function isAdmin(Request $request): bool
    {
        return (bool) $request->user()?->is_super_admin;
    }

    /** Every ticket for an administrator; your own for everybody else. */
    private function scope(Request $request)
    {
        $query = SupportTicket::query();

        return $this->isAdmin($request)
            ? $query
            : $query->where('raised_by', $request->user()->id);
    }

    private function assertVisible(Request $request, SupportTicket $ticket): void
    {
        abort_unless(
            $this->isAdmin($request) || $ticket->raised_by === $request->user()->id,
            404,
            'Ticket not found.',
        );
    }

    /* =============================== Shaping ================================ */

    private function counts(Request $request): array
    {
        $base = fn () => $this->scope($request);

        return [
            'open' => (clone $base())->where('status', 'Open')->count(),
            'inProgress' => (clone $base())->where('status', 'In progress')->count(),
            'waiting' => (clone $base())->where('status', 'Waiting on you')->count(),
            'resolved' => (clone $base())->where('status', 'Resolved')->count(),
            'closed' => (clone $base())->where('status', 'Closed')->count(),
            'urgent' => (clone $base())->whereNotIn('status', ['Resolved', 'Closed'])->where('priority', 'Urgent')->count(),
            'stale' => (clone $base())->whereNotIn('status', ['Resolved', 'Closed'])
                ->where(function ($q) {
                    $q->where('last_activity_at', '<', now()->subHours(self::STALE_HOURS))
                        ->orWhereNull('last_activity_at');
                })->count(),
        ];
    }

    private function card(SupportTicket $ticket): array
    {
        return [
            'id' => $ticket->id,
            'reference' => $ticket->reference,
            'subject' => $ticket->subject,
            'category' => $ticket->category,
            'priority' => $ticket->priority,
            'status' => $ticket->status,
            'raisedBy' => $ticket->raiser?->name,
            'raisedById' => $ticket->raised_by,
            'raiserEmployeeNo' => $ticket->raiser?->employee?->employee_no,
            'assignedTo' => $ticket->assignee?->name,
            'messageCount' => (int) $ticket->messages_count,
            'attachmentCount' => (int) $ticket->attachments_count,
            'createdAt' => $ticket->created_at?->toIso8601String(),
            'lastActivityAt' => $ticket->last_activity_at?->toIso8601String(),
            'idleHours' => $ticket->idleHours(),
            'isStale' => $ticket->isOpen() && $ticket->idleHours() >= self::STALE_HOURS,
            'isOpen' => $ticket->isOpen(),
        ];
    }

    private function file(SupportTicketAttachment $a): array
    {
        return [
            'id' => $a->id,
            'name' => $a->original_name,
            'url' => $a->url(),
            'mimeType' => $a->mime_type,
            'size' => (int) $a->size_bytes,
            'isImage' => $a->isImage(),
            'width' => $a->width,
            'height' => $a->height,
            'uploadedBy' => $a->uploader?->name,
        ];
    }

    /* =============================== Email ================================== */

    private function notifyAdmins(SupportTicket $ticket, User $raiser): void
    {
        $admins = User::where('is_super_admin', true)->where('status', 'Active')->get();

        foreach ($admins as $admin) {
            if (! filter_var((string) $admin->email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }

            $this->mailer->send(
                $admin->email,
                "[{$ticket->reference}] {$ticket->subject}",
                'emails.ticket',
                [
                    'user' => $admin,
                    'ticket' => $ticket,
                    'headline' => 'A new ticket has been raised',
                    'lead' => $raiser->name.' raised a '.strtolower($ticket->priority).' priority '.strtolower($ticket->category).' ticket.',
                    'bodyText' => $ticket->body,
                    'ctaLabel' => 'Open the ticket',
                    'ctaUrl' => $this->url($ticket, true),
                ],
                'ticket.raised',
                'SupportTicket',
                $ticket->id,
            );
        }
    }

    private function notifyReply(SupportTicket $ticket, User $author, string $body, bool $fromAdmin): void
    {
        // A reply from staff goes to the raiser; a reply from the raiser goes
        // to whoever owns it, or to the administrators if nobody does yet.
        $recipients = $fromAdmin
            ? collect([$ticket->raiser])
            : collect([$ticket->assignee])->filter()->whenEmpty(
                fn () => User::where('is_super_admin', true)->where('status', 'Active')->get()
            );

        foreach ($recipients->filter()->reject(fn (User $u) => $u->id === $author->id) as $user) {
            if (! filter_var((string) $user->email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }

            $this->mailer->send(
                $user->email,
                "[{$ticket->reference}] {$ticket->subject}",
                'emails.ticket',
                [
                    'user' => $user,
                    'ticket' => $ticket,
                    'headline' => $author->name.' replied',
                    'lead' => 'There is a new reply on this ticket.',
                    'bodyText' => $body,
                    'ctaLabel' => 'Read the reply',
                    'ctaUrl' => $this->url($ticket, $fromAdmin === false),
                ],
                'ticket.replied',
                'SupportTicket',
                $ticket->id,
            );
        }
    }

    private function notifyResolved(SupportTicket $ticket, User $actor): void
    {
        $raiser = $ticket->raiser;

        if (! $raiser || ! filter_var((string) $raiser->email, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        $this->mailer->send(
            $raiser->email,
            "[{$ticket->reference}] Resolved — {$ticket->subject}",
            'emails.ticket',
            [
                'user' => $raiser,
                'ticket' => $ticket,
                'headline' => 'Your ticket has been resolved',
                'lead' => $actor->name.' marked this resolved. If it is not sorted, reopen it and say so.',
                'bodyText' => $ticket->resolution,
                'ctaLabel' => 'View the ticket',
                'ctaUrl' => $this->url($ticket, false),
            ],
            'ticket.resolved',
            'SupportTicket',
            $ticket->id,
        );
    }

    /** Where the recipient should land — the admin queue or their own list. */
    private function url(SupportTicket $ticket, bool $admin): string
    {
        $base = rtrim((string) config('app.url'), '/');

        return $base.($admin ? '/admin/tickets?ticket=' : '/support?ticket=').$ticket->id;
    }
}
