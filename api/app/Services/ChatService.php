<?php

namespace App\Services;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\HrDepartment;
use App\Models\Message;
use App\Models\MessageDeletion;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Workspace messaging.
 *
 * The rules that matter are all about visibility, and they are enforced here
 * rather than in the controller so no endpoint can forget one:
 *
 *   - You only ever see conversations you are a participant of.
 *   - A message you deleted "for me" is gone from your reads and nobody
 *     else's.
 *   - A message withdrawn "for everyone" survives as a tombstone, so replies
 *     to it still resolve and the row can still be audited.
 *   - Unread counts are computed from a single high-water mark per person,
 *     not a read receipt per message per reader.
 */
class ChatService
{
    public function __construct(private readonly PollService $polls) {}

    /** How long after sending a message it may still be withdrawn for everyone. */
    public const WITHDRAW_WINDOW_MINUTES = 60;

    /** How long after sending a message its author may still reword it. */
    /** How long after a keystroke somebody still counts as typing. */
    public const TYPING_WINDOW_SECONDS = 6;

    /** How long after their last poll somebody still counts as online. */
    public const PRESENCE_WINDOW_MINUTES = 3;

    public const EDIT_WINDOW_MINUTES = 15;

    /* ====================================================================== */
    /* Rooms */
    /* ====================================================================== */

    /**
     * Finds or opens the one-to-one thread between two people.
     *
     * Direct threads are deduplicated on the pair, so messaging somebody twice
     * from two different screens does not leave two half-finished threads.
     */
    public function directWith(User $me, User $other): Conversation
    {
        $existing = Conversation::query()
            ->where('kind', 'direct')
            ->whereHas('participants', fn ($q) => $q->where('user_id', $me->id))
            ->whereHas('participants', fn ($q) => $q->where('user_id', $other->id))
            ->withCount('participants')
            ->get()
            ->firstWhere('participants_count', 2);

        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($me, $other) {
            $conversation = Conversation::create([
                'kind' => 'direct',
                'created_by' => $me->id,
                'last_message_at' => now(),
            ]);

            foreach ([$me, $other] as $person) {
                $conversation->participants()->create([
                    'user_id' => $person->id,
                    'role' => 'member',
                    'joined_at' => now(),
                ]);
            }

            return $conversation;
        });
    }

    /** @param  array<int>  $memberIds */
    public function createGroup(User $creator, string $name, array $memberIds, ?string $icon = null, ?string $topic = null): Conversation
    {
        return DB::transaction(function () use ($creator, $name, $memberIds, $icon, $topic) {
            $conversation = Conversation::create([
                'kind' => 'group',
                'name' => $name,
                'topic' => $topic,
                'icon' => $icon ?: '💬',
                'created_by' => $creator->id,
                'last_message_at' => now(),
            ]);

            // The creator is always in, and always an admin — a group nobody can
            // administer is a group nobody can fix.
            $ids = collect($memberIds)->push($creator->id)->unique()->values();

            foreach ($ids as $id) {
                $conversation->participants()->create([
                    'user_id' => $id,
                    'role' => $id === $creator->id ? 'admin' : 'member',
                    'joined_at' => now(),
                ]);
            }

            $this->system($conversation, "{$creator->name} created this group");

            return $conversation;
        });
    }

    /**
     * Creates a room per department and keeps its membership in step.
     *
     * Rerunnable: it adds people who have joined a department and never removes
     * anyone automatically — somebody who transferred still has history worth
     * reading, and dropping them silently loses it.
     *
     * @return array{created: int, added: int}
     */
    public function syncDepartments(): array
    {
        $created = 0;
        $added = 0;

        foreach (HrDepartment::orderBy('name')->get() as $department) {
            $conversation = Conversation::firstOrNew([
                'kind' => 'department',
                'hr_department_id' => $department->id,
            ]);

            if (! $conversation->exists) {
                $conversation->fill([
                    'name' => $department->name,
                    'icon' => '🏢',
                    'topic' => "Everyone in {$department->name}",
                    'last_message_at' => now(),
                ])->save();
                $created++;
            } elseif ($conversation->name !== $department->name) {
                // The department was renamed; the room follows it.
                $conversation->update(['name' => $department->name]);
            }

            $userIds = User::query()
                ->where('status', 'Active')
                ->whereHas('employee', fn ($q) => $q->where('hr_department_id', $department->id))
                ->pluck('id');

            $existing = $conversation->participants()->pluck('user_id')->all();

            foreach ($userIds->diff($existing) as $userId) {
                $conversation->participants()->create([
                    'user_id' => $userId,
                    'role' => 'member',
                    'joined_at' => now(),
                ]);
                $added++;
            }
        }

        return compact('created', 'added');
    }

    /* ====================================================================== */
    /* Reading */
    /* ====================================================================== */

    /**
     * Every room this person is in, newest activity first.
     *
     * The unread count deliberately ignores the reader's own messages and
     * anything they have hidden — a badge that counts your own typing is
     * noise, not information.
     */
    /**
     * Somebody's conversation list.
     *
     * `$archived` picks which half: the working list, or the ones put away.
     * They are never mixed — an archive that still appears among live threads
     * has not archived anything.
     */
    public function conversationsFor(User $me, bool $archived = false): array
    {
        $conversations = Conversation::query()
            ->whereHas('participants', function ($q) use ($me, $archived) {
                $q->where('user_id', $me->id);

                /* Archiving is per person, so the filter is on the
                   participant row. A thread you put down stays exactly where
                   it was in everybody else's list. */
                $archived ? $q->whereNotNull('archived_at') : $q->whereNull('archived_at');
            })
            ->with(['members:id,name,avatar_path,status', 'participants', 'pinnedMessage'])
            ->orderByDesc('last_message_at')
            ->get();

        $hidden = MessageDeletion::where('user_id', $me->id)->pluck('message_id');

        return $conversations->map(function (Conversation $conversation) use ($me, $hidden) {
            $mine = $conversation->participants->firstWhere('user_id', $me->id);
            $lastRead = (int) ($mine?->last_read_message_id ?? 0);

            $unread = Message::where('conversation_id', $conversation->id)
                ->where('id', '>', $lastRead)
                ->where('user_id', '!=', $me->id)
                ->whereNotIn('id', $hidden)
                ->count();

            $last = Message::where('conversation_id', $conversation->id)
                ->whereNotIn('id', $hidden)
                ->with('author:id,name')
                ->latest('id')
                ->first();

            return [
                'id' => $conversation->id,
                'kind' => $conversation->kind,
                'name' => $conversation->titleFor($me),
                'topic' => $conversation->topic,
                'archivedAt' => optional($mine?->archived_at)->toIso8601String(),
                /* What this person may do to the thread, decided here so the
                   screen never offers a control the server would refuse. A
                   department room is kept in step with the org chart and is
                   nobody's to leave or destroy. */
                'canLeave' => $conversation->kind === 'group',
                'canDelete' => $conversation->kind === 'group' && ($mine?->role === 'admin'),
                'icon' => $conversation->icon,
                'muted' => (bool) ($mine?->muted),
                'role' => $mine?->role ?? 'member',
                'unread' => $unread,
                'memberCount' => $conversation->members->count(),
                'members' => $conversation->members->take(12)->map(fn ($u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'status' => $u->status,
                ])->values(),
                'lastMessage' => $last ? [
                    'id' => $last->id,
                    'body' => $last->deleted_at ? null : $last->body,
                    'withdrawn' => (bool) $last->deleted_at,
                    'isSystem' => (bool) $last->is_system,
                    'author' => $last->author?->name,
                    'authorId' => $last->user_id,
                    'at' => $last->created_at?->toIso8601String(),
                ] : null,
                'lastMessageAt' => $conversation->last_message_at?->toIso8601String(),
                /* The one message held at the top of the room. Resolved here
                   rather than in the client so a pin that has since been
                   withdrawn simply disappears instead of showing a tombstone
                   banner nobody can dismiss. */
                'pinned' => $conversation->pinnedMessage && ! $conversation->pinnedMessage->deleted_at
                    ? [
                        'id' => $conversation->pinnedMessage->id,
                        'body' => $conversation->pinnedMessage->body,
                        'author' => $conversation->pinnedMessage->author?->name,
                        'at' => $conversation->pinnedMessage->created_at?->toIso8601String(),
                    ]
                    : null,
            ];
        })->all();
    }

    /** @return array<int, array<string, mixed>> */
    public function messagesFor(User $me, Conversation $conversation, ?int $before = null, int $limit = 40): array
    {
        $hidden = MessageDeletion::where('user_id', $me->id)->pluck('message_id');

        $query = Message::where('conversation_id', $conversation->id)
            ->whereNotIn('id', $hidden)
            ->with(['author:id,name,avatar_path', 'replyTo.author:id,name', 'reactions.user:id,name'])
            ->orderByDesc('id')
            ->limit($limit);

        if ($before) {
            $query->where('id', '<', $before);
        }

        $messages = $query->get()->reverse()->values()->map(fn (Message $m) => $this->present($m, $me))->all();

        return $this->attachPolls($messages, $me);
    }

    /** Messages newer than an id — the polling endpoint's payload. */
    public function messagesSince(User $me, Conversation $conversation, int $after): array
    {
        $hidden = MessageDeletion::where('user_id', $me->id)->pluck('message_id');

        $messages = Message::where('conversation_id', $conversation->id)
            ->where('id', '>', $after)
            ->whereNotIn('id', $hidden)
            ->with(['author:id,name,avatar_path', 'replyTo.author:id,name', 'reactions.user:id,name'])
            ->orderBy('id')
            ->get()
            ->map(fn (Message $m) => $this->present($m, $me))
            ->all();

        return $this->attachPolls($messages, $me);
    }

    /**
     * Fills in the `poll` slot for whichever messages carry one.
     *
     * Done for the whole page in one query — a forty-line thread should not
     * cost forty round trips because three of its lines are polls.
     *
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function attachPolls(array $messages, User $me): array
    {
        if (! $messages) {
            return $messages;
        }

        $polls = $this->polls->forMessages(array_column($messages, 'id'), $me);

        if (! $polls) {
            return $messages;
        }

        foreach ($messages as $i => $message) {
            $messages[$i]['poll'] = $polls[$message['id']] ?? null;
        }

        return $messages;
    }

    /** One message with its poll resolved — for the single-message responses. */
    public function presentWithPoll(Message $message, User $me): array
    {
        $presented = $this->present($message, $me);
        $presented['poll'] = $this->polls->forMessages([$message->id], $me)[$message->id] ?? null;

        return $presented;
    }

    /** @return array<string, mixed> */
    public function present(Message $message, User $me): array
    {
        $withdrawn = $message->deleted_at !== null;
        $mine = $message->user_id === $me->id && ! $message->is_system;
        $ageMinutes = $message->created_at ? $message->created_at->diffInMinutes(now()) : PHP_INT_MAX;

        return [
            'id' => $message->id,
            'conversationId' => $message->conversation_id,
            'authorId' => $message->user_id,
            'author' => $message->author?->name ?? 'Removed user',
            'mine' => $mine,
            // The body is withheld at the source, not hidden in the client —
            // a withdrawn message must not travel over the wire at all.
            'body' => $withdrawn ? null : $message->body,
            'withdrawn' => $withdrawn,
            'isSystem' => (bool) $message->is_system,
            'editedAt' => $message->edited_at?->toIso8601String(),
            'at' => $message->created_at?->toIso8601String(),
            'canWithdraw' => $mine && ! $withdrawn && $ageMinutes < self::WITHDRAW_WINDOW_MINUTES,
            'canEdit' => $mine && ! $withdrawn && $ageMinutes < self::EDIT_WINDOW_MINUTES,
            // Filled in by attachPolls for the lines that carry one. Declared
            // here so the shape is the same whether or not a poll exists.
            'poll' => null,
            'replyTo' => $message->replyTo ? [
                'id' => $message->replyTo->id,
                'author' => $message->replyTo->author?->name,
                'body' => $message->replyTo->deleted_at ? null : $message->replyTo->body,
                'withdrawn' => $message->replyTo->deleted_at !== null,
            ] : null,
            /* Withheld along with the body when a message is withdrawn — a
               tombstone that still serves its photographs is not withdrawn. */
            'attachments' => $withdrawn
                ? []
                : $message->attachments->map(fn ($a) => [
                    'id' => $a->id,
                    'kind' => $a->kind,
                    'url' => $a->url,
                    'name' => $a->original_name,
                    'mime' => $a->mime,
                    'size' => $a->size_label,
                    'width' => $a->width,
                    'height' => $a->height,
                ])->values(),
            'reactions' => $message->reactions->groupBy('emoji')->map(fn ($group, $emoji) => [
                'emoji' => $emoji,
                'count' => $group->count(),
                'mine' => $group->contains('user_id', $me->id),
                'by' => $group->map(fn ($r) => $r->user?->name)->filter()->values(),
            ])->values(),
        ];
    }

    /**
     * Who is typing in this room right now, other than you.
     *
     * Six seconds is the window. Long enough to survive the gap between
     * keystrokes on a phone, short enough that somebody who closed the tab
     * mid-sentence stops appearing almost immediately — which matters more,
     * because a name stuck under "typing…" forever is worse than no indicator.
     *
     * @return array<int, string>
     */
    public function typingIn(Conversation $conversation, User $me): array
    {
        return $conversation->participants()
            ->where('user_id', '!=', $me->id)
            ->where('last_typing_at', '>=', now()->subSeconds(self::TYPING_WINDOW_SECONDS))
            ->with('user:id,name')
            ->get()
            ->map(fn ($p) => $p->user?->name)
            ->filter()
            ->values()
            ->all();
    }

    /**
     * Who has read as far as the last message, and who is about.
     *
     * Read state comes from each participant's pointer rather than a row per
     * message per reader — the same data the unread badge already uses, asked
     * a different question.
     *
     * @return array{seenBy: array<int, string>, present: array<int, array{name: string, online: bool}>}
     */
    public function readState(Conversation $conversation, User $me): array
    {
        $lastId = (int) ($conversation->messages()->max('id') ?? 0);

        $participants = $conversation->participants()->with('user:id,name,last_seen_at')->get();

        return [
            'seenBy' => $participants
                ->filter(fn ($p) => $p->user_id !== $me->id
                    && $lastId > 0
                    && (int) $p->last_read_message_id >= $lastId)
                ->map(fn ($p) => $p->user?->name)
                ->filter()
                ->values()
                ->all(),
            'present' => $participants
                ->filter(fn ($p) => $p->user_id !== $me->id)
                ->map(fn ($p) => [
                    'name' => $p->user?->name ?? 'Removed user',
                    'online' => $p->user?->last_seen_at
                        && $p->user->last_seen_at->gte(now()->subMinutes(self::PRESENCE_WINDOW_MINUTES)),
                ])
                ->values()
                ->all(),
        ];
    }

    /**
     * Records that somebody is still at their desk.
     *
     * Called from the poll every client already runs, so presence costs one
     * column write on a request that was happening anyway rather than a
     * heartbeat of its own.
     */
    public function touchPresence(User $me): void
    {
        // Written at most once a minute. Presence to the second is not worth a
        // write on every poll from every open tab.
        if (! $me->last_seen_at || $me->last_seen_at->lt(now()->subMinute())) {
            $me->forceFill(['last_seen_at' => now()])->saveQuietly();
        }
    }

    /* ====================================================================== */
    /* Writing */
    /* ====================================================================== */

    public function send(User $me, Conversation $conversation, string $body, ?int $replyToId = null): Message
    {
        $message = DB::transaction(function () use ($me, $conversation, $body, $replyToId) {
            $message = Message::create([
                'conversation_id' => $conversation->id,
                'user_id' => $me->id,
                'body' => $body,
                'reply_to_id' => $replyToId,
            ]);

            $conversation->update(['last_message_at' => $message->created_at]);

            // Sending is also reading: your own message must not come back to
            // you as unread the moment you press enter.
            $conversation->participants()
                ->where('user_id', $me->id)
                ->update(['last_read_message_id' => $message->id]);

            return $message;
        });

        return $message->load(['author:id,name', 'replyTo.author:id,name', 'reactions', 'attachments']);
    }

    public function system(Conversation $conversation, string $body): Message
    {
        $message = Message::create([
            'conversation_id' => $conversation->id,
            'user_id' => null,
            'body' => $body,
            'is_system' => true,
        ]);

        $conversation->update(['last_message_at' => $message->created_at]);

        return $message;
    }

    /**
     * Rewrites a message's body.
     *
     * `edited_at` is stamped so the thread can say so — an edit that leaves no
     * trace is indistinguishable from misremembering what was agreed.
     */
    public function edit(Message $message, string $body): Message
    {
        $message->update(['body' => $body, 'edited_at' => now()]);

        return $message->load(['author:id,name', 'replyTo.author:id,name', 'reactions.user:id,name']);
    }

    /** Hides a message from one person's view. Everyone else keeps it. */
    public function deleteForMe(User $me, Message $message): void
    {
        MessageDeletion::firstOrCreate([
            'message_id' => $message->id,
            'user_id' => $me->id,
        ]);
    }

    /**
     * Withdraws a message for everyone.
     *
     * The row survives with its body cleared, which is what lets the thread
     * still render "this message was deleted" in the right place rather than
     * silently reflowing and leaving replies pointing at nothing.
     */
    public function deleteForEveryone(User $me, Message $message): void
    {
        $message->forceFill([
            'body' => null,
            'deleted_at' => now(),
            'deleted_by' => $me->id,
        ])->save();

        $message->reactions()->delete();
    }

    public function react(User $me, Message $message, ?string $emoji): void
    {
        if (! $emoji) {
            $message->reactions()->where('user_id', $me->id)->delete();

            return;
        }

        // One per person: choosing a second replaces the first.
        $message->reactions()->updateOrCreate(
            ['user_id' => $me->id],
            ['emoji' => $emoji],
        );
    }

    public function markRead(User $me, Conversation $conversation, ?int $messageId = null): void
    {
        $latest = $messageId ?: Message::where('conversation_id', $conversation->id)->max('id');

        $conversation->participants()
            ->where('user_id', $me->id)
            ->update(['last_read_message_id' => $latest]);
    }

    /* ====================================================================== */
    /* Membership */
    /* ====================================================================== */

    public function isMember(User $me, Conversation $conversation): bool
    {
        return $conversation->participants()->where('user_id', $me->id)->exists();
    }

    public function isAdmin(User $me, Conversation $conversation): bool
    {
        return $conversation->participants()
            ->where('user_id', $me->id)
            ->where('role', 'admin')
            ->exists();
    }

    /**
     * Renames a group, or changes its icon or topic.
     *
     * Every change writes a system line, because "who renamed this room" is a
     * question somebody always asks and nobody can ever answer.
     *
     * @param  array{name?: string, icon?: string, topic?: string}  $changes
     */
    public function updateRoom(User $actor, Conversation $conversation, array $changes): Conversation
    {
        $before = $conversation->name;
        $conversation->fill(array_filter($changes, fn ($v) => $v !== null))->save();

        if (isset($changes['name']) && $changes['name'] !== $before) {
            $this->system($conversation, "{$actor->name} renamed the group to {$changes['name']}");
        }

        return $conversation->refresh();
    }

    /** Silences a room's badge for one person only. */
    public function setMuted(User $me, Conversation $conversation, bool $muted): void
    {
        $conversation->participants()
            ->where('user_id', $me->id)
            ->update(['muted' => $muted]);
    }

    /** @param  array<int>  $userIds */
    public function addMembers(User $actor, Conversation $conversation, array $userIds): int
    {
        $existing = $conversation->participants()->pluck('user_id')->all();
        $added = 0;

        foreach (array_diff($userIds, $existing) as $userId) {
            $conversation->participants()->create([
                'user_id' => $userId,
                'role' => 'member',
                'joined_at' => now(),
            ]);
            $added++;
        }

        if ($added) {
            $names = User::whereIn('id', array_diff($userIds, $existing))->pluck('name')->implode(', ');
            $this->system($conversation, "{$actor->name} added {$names}");
        }

        return $added;
    }

    public function removeMember(User $actor, Conversation $conversation, User $target): void
    {
        ConversationParticipant::where('conversation_id', $conversation->id)
            ->where('user_id', $target->id)
            ->delete();

        $this->system(
            $conversation,
            $actor->id === $target->id ? "{$actor->name} left" : "{$actor->name} removed {$target->name}",
        );
    }

    /** Everyone this person could start a conversation with. */
    public function directory(User $me): Collection
    {
        return User::query()
            ->where('status', 'Active')
            ->whereKeyNot($me->getKey())
            ->with('employee.hrDepartment:id,name')
            ->orderBy('name')
            ->get(['id', 'name', 'username', 'employee_id', 'status']);
    }

    /** Total unread across every room — the badge in the top bar. */
    public function unreadTotal(User $me): int
    {
        $hidden = MessageDeletion::where('user_id', $me->id)->pluck('message_id');

        // Muted rooms are excluded: muting that still lights up the badge is
        // not muting, it is a slower way of being interrupted.
        return (int) ConversationParticipant::where('user_id', $me->id)
            ->where('muted', false)
            ->get()
            ->sum(fn ($p) => Message::where('conversation_id', $p->conversation_id)
                ->where('id', '>', (int) ($p->last_read_message_id ?? 0))
                ->where('user_id', '!=', $me->id)
                ->whereNotIn('id', $hidden)
                ->count());
    }
}
