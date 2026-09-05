<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Poll;
use App\Models\User;
use App\Services\ChatService;
use App\Services\PollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Workspace messaging.
 *
 * Every route that names a conversation goes through `member()` or `admin()`
 * first. Membership is the only thing standing between one department's thread
 * and the rest of the company, so it is checked here on the way in rather than
 * trusted to the client having hidden the room.
 *
 * The client polls `updates` rather than holding a socket open. Shared hosting
 * has no websocket to hold, and a poll on a room somebody is actually looking
 * at costs one indexed query.
 */
class ChatController extends Controller
{
    public function __construct(private readonly ChatService $chat) {}

    /* ====================================================================== */
    /* Rooms */
    /* ====================================================================== */

    /**
     * Every room this person is in, newest activity first.
     *
     * `?archived=1` returns the ones they have put away instead. The two
     * lists are never mixed: an archive that still shows among live threads
     * has not archived anything.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'data' => $this->chat->conversationsFor(
                $this->me($request),
                $request->boolean('archived'),
            ),
        ]);
    }

    /**
     * Puts a conversation away, or brings it back.
     *
     * Per person, always. Archiving a thread you share with somebody must not
     * remove it from their list — that would be one person deleting another
     * person's mail — so this only ever writes to the caller's own
     * participant row.
     *
     * Nothing is deleted and nothing is marked read: coming back to an
     * archived thread finds it exactly as it was left, unread count and all.
     */
    public function archive(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $archived = $request->boolean('archived', true);

        ConversationParticipant::where('conversation_id', $conversation->id)
            ->where('user_id', $me->id)
            ->update(['archived_at' => $archived ? now() : null]);

        return response()->json([
            'data' => [
                'id' => $conversation->id,
                'archived' => $archived,
                'message' => $archived
                    ? 'Moved to your archive. It comes back on its own if somebody writes in it.'
                    : 'Back in your conversations.',
            ],
        ]);
    }

    /**
     * Leaves a group.
     *
     * Only a group. A direct thread has two people in it and leaving would
     * leave the other talking to nobody — archive is the answer there. A
     * department room is kept in step with the org chart, so leaving one
     * would be undone by the next sync and is refused rather than quietly
     * reversed later.
     */
    public function leave(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        if ($conversation->kind !== 'group') {
            return response()->json([
                'message' => $conversation->kind === 'direct'
                    ? 'A direct conversation cannot be left — archive it instead, which takes it off your list '
                        .'without touching theirs.'
                    : 'A department room follows the org chart, so leaving it would be undone by the next sync. '
                        .'Archive it instead, or mute it.',
            ], 422);
        }

        // The service already knows how to take somebody out of a room and
        // announce it; leaving is just doing that to yourself.
        $this->chat->removeMember($me, $conversation, $me);

        return response()->json([
            'data' => ['id' => $conversation->id, 'message' => 'You have left the conversation.'],
        ]);
    }

    /**
     * Deletes a group for everybody in it.
     *
     * Restricted to an admin of that group, and to groups. A direct thread
     * belongs as much to the other person as to you, and a department room
     * belongs to the org chart — neither is one participant's to destroy, and
     * archiving already solves the problem either of them poses.
     *
     * Soft, so the messages survive for an audit and a mistake is recoverable
     * from the database. Nobody sees it again from the application.
     */
    public function destroyConversation(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $mine = ConversationParticipant::where('conversation_id', $conversation->id)
            ->where('user_id', $me->id)
            ->first();

        if ($conversation->kind !== 'group' || $mine?->role !== 'admin') {
            return response()->json([
                'message' => $conversation->kind === 'group'
                    ? 'Only an admin of this group can delete it for everybody. You can leave it, or archive it.'
                    : 'This conversation is not yours alone to delete. Archive it — that takes it off your list '
                        .'and leaves everybody else theirs.',
            ], 422);
        }

        $conversation->delete();

        return response()->json([
            'data' => [
                'id' => $conversation->id,
                'message' => 'The conversation has been deleted for everybody in it.',
            ],
        ]);
    }

    /** Everyone this person could start a conversation with. */
    public function directory(Request $request): JsonResponse
    {
        $me = $this->me($request);

        return response()->json([
            'data' => $this->chat->directory($me)->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'department' => $u->employee?->hrDepartment?->name,
                'status' => $u->status,
            ])->values(),
        ]);
    }

    /** Opens — or reopens — the one-to-one thread with somebody. */
    public function direct(Request $request): JsonResponse
    {
        $data = $request->validate(['userId' => 'required|integer|exists:users,id']);
        $me = $this->me($request);

        if ((int) $data['userId'] === $me->id) {
            return response()->json(['message' => 'You cannot start a conversation with yourself.'], 422);
        }

        $conversation = $this->chat->directWith($me, User::findOrFail($data['userId']));

        return response()->json(['data' => $this->room($conversation, $me)], 201);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:150',
            'memberIds' => 'required|array|min:1',
            'memberIds.*' => 'integer|exists:users,id',
            'icon' => 'nullable|string|max:16',
            'topic' => 'nullable|string|max:255',
        ]);

        $me = $this->me($request);

        $conversation = $this->chat->createGroup(
            $me,
            $data['name'],
            $data['memberIds'],
            $data['icon'] ?? null,
            $data['topic'] ?? null,
        );

        return response()->json(['data' => $this->room($conversation, $me)], 201);
    }

    /** Renames a group, changes its icon or topic, or mutes it for the caller. */
    public function update(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate([
            'name' => 'nullable|string|max:150',
            'icon' => 'nullable|string|max:16',
            'topic' => 'nullable|string|max:255',
            'muted' => 'nullable|boolean',
        ]);

        // Muting is a personal setting and needs no authority over the room.
        if (array_key_exists('muted', $data) && $data['muted'] !== null) {
            $this->chat->setMuted($me, $conversation, (bool) $data['muted']);
        }

        $changes = array_filter(
            ['name' => $data['name'] ?? null, 'icon' => $data['icon'] ?? null, 'topic' => $data['topic'] ?? null],
            fn ($v) => $v !== null,
        );

        if ($changes) {
            // A direct thread is named after the other person, and a department
            // room is named after the department — neither is ours to rename.
            if ($conversation->kind !== 'group') {
                throw new AccessDeniedHttpException('Only group conversations can be renamed.');
            }
            if (! $this->chat->isAdmin($me, $conversation)) {
                throw new AccessDeniedHttpException('Only a group admin can change these details.');
            }

            $this->chat->updateRoom($me, $conversation, $changes);
        }

        return response()->json(['data' => $this->room($conversation->refresh(), $me)]);
    }

    /** Creates a room per department and brings its membership up to date. */
    public function syncDepartments(Request $request): JsonResponse
    {
        $this->me($request);

        return response()->json(['data' => $this->chat->syncDepartments()]);
    }

    /* ====================================================================== */
    /* Messages */
    /* ====================================================================== */

    /** A page of history, newest last. `before` walks further back. */
    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate([
            'before' => 'nullable|integer|min:1',
            'limit' => 'nullable|integer|min:1|max:100',
        ]);

        $messages = $this->chat->messagesFor(
            $me,
            $conversation,
            isset($data['before']) ? (int) $data['before'] : null,
            (int) ($data['limit'] ?? 40),
        );

        return response()->json([
            'data' => [
                'messages' => $messages,
                // Fewer than a full page came back, so there is nothing older.
                'hasMore' => count($messages) === (int) ($data['limit'] ?? 40),
            ],
        ]);
    }

    /**
     * The polling endpoint.
     *
     * Returns anything said since `after`, plus the whole-app unread total so
     * the top bar's badge stays honest without a second request. Opening a room
     * is also reading it, so the caller's high-water mark moves here too.
     */
    public function updates(Request $request, Conversation $conversation, PollService $polls): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate(['after' => 'required|integer|min:0']);

        $messages = $this->chat->messagesSince($me, $conversation, (int) $data['after']);

        if ($messages) {
            $this->chat->markRead($me, $conversation);
        }

        // Presence rides the poll rather than a heartbeat of its own: the
        // request was happening anyway, so being online costs one column write.
        $this->chat->touchPresence($me);
        $read = $this->chat->readState($conversation, $me);

        return response()->json([
            'data' => [
                'messages' => $messages,
                // Tallies for polls already on screen — they change without a
                // new message arriving, so they cannot ride on `messages`.
                'polls' => $polls->openIn($conversation, $me),
                'unreadTotal' => $this->chat->unreadTotal($me),
                // The three things that make a thread feel live rather than
                // fetched. All cheap, all derived from rows already read.
                'typing' => $this->chat->typingIn($conversation, $me),
                'seenBy' => $read['seenBy'],
                'present' => $read['present'],
            ],
        ]);
    }

    public function send(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate([
            'body' => 'required|string|max:4000',
            'replyToId' => 'nullable|integer|exists:messages,id',
        ]);

        // A reply may only point at a message in the same room — otherwise a
        // quoted line could drag text out of a thread the reader is not in.
        if (! empty($data['replyToId'])) {
            $parent = Message::find($data['replyToId']);
            if (! $parent || $parent->conversation_id !== $conversation->id) {
                return response()->json(['message' => 'You can only reply to a message in this conversation.'], 422);
            }
        }

        $message = $this->chat->send($me, $conversation, trim($data['body']), $data['replyToId'] ?? null);

        return response()->json(['data' => $this->chat->present($message, $me)], 201);
    }

    public function editMessage(Request $request, Message $message): JsonResponse
    {
        $me = $this->member($request, $message->conversation);

        $data = $request->validate(['body' => 'required|string|max:4000']);

        if ($message->user_id !== $me->id || $message->is_system) {
            throw new AccessDeniedHttpException('You can only edit your own messages.');
        }
        if ($message->isWithdrawn()) {
            return response()->json(['message' => 'That message has been deleted.'], 422);
        }
        if ($message->created_at && $message->created_at->diffInMinutes(now()) >= ChatService::EDIT_WINDOW_MINUTES) {
            return response()->json([
                'message' => 'Messages can only be edited within '.ChatService::EDIT_WINDOW_MINUTES.' minutes of sending.',
            ], 422);
        }

        return response()->json(['data' => $this->chat->presentWithPoll($this->chat->edit($message, trim($data['body'])), $me)]);
    }

    /**
     * Deletes a message one of two ways.
     *
     * `me` hides it from the caller alone. `everyone` withdraws it, which only
     * its author may do, and only inside the withdraw window — after that the
     * thread is a record other people have already acted on.
     */
    public function destroyMessage(Request $request, Message $message): JsonResponse
    {
        $me = $this->member($request, $message->conversation);

        $scope = $request->validate(['scope' => 'nullable|in:me,everyone'])['scope'] ?? 'me';

        if ($scope === 'everyone') {
            $isAuthor = $message->user_id === $me->id && ! $message->is_system;
            $withinWindow = $message->created_at
                && $message->created_at->diffInMinutes(now()) < ChatService::WITHDRAW_WINDOW_MINUTES;

            if (! $isAuthor) {
                throw new AccessDeniedHttpException('Only the author can delete a message for everyone.');
            }
            if (! $withinWindow) {
                return response()->json([
                    'message' => 'A message can only be withdrawn within '.ChatService::WITHDRAW_WINDOW_MINUTES.' minutes of sending.',
                ], 422);
            }

            $this->chat->deleteForEveryone($me, $message);
        } else {
            $this->chat->deleteForMe($me, $message);
        }

        return response()->json(['data' => ['id' => $message->id, 'scope' => $scope]]);
    }

    /** Sets, changes or clears the caller's reaction. A null emoji clears it. */
    public function react(Request $request, Message $message): JsonResponse
    {
        $me = $this->member($request, $message->conversation);

        $data = $request->validate(['emoji' => 'nullable|string|max:16']);

        if ($message->isWithdrawn()) {
            return response()->json(['message' => 'That message has been deleted.'], 422);
        }

        $this->chat->react($me, $message, $data['emoji'] ?? null);

        // With the poll resolved: reacting to a poll must not blank it out.
        return response()->json([
            'data' => $this->chat->presentWithPoll($message->load('reactions.user:id,name'), $me),
        ]);
    }

    public function markRead(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate(['messageId' => 'nullable|integer|min:1']);

        $this->chat->markRead($me, $conversation, isset($data['messageId']) ? (int) $data['messageId'] : null);

        return response()->json(['data' => ['unreadTotal' => $this->chat->unreadTotal($me)]]);
    }

    /** The top bar's badge, polled on its own while no room is open. */
    public function unread(Request $request): JsonResponse
    {
        return response()->json(['data' => ['unreadTotal' => $this->chat->unreadTotal($this->me($request))]]);
    }

    /* ====================================================================== */
    /* Polls */
    /* ====================================================================== */

    /**
     * Asks a question in a conversation.
     *
     * The poll rides on a normal message, so it lands in the thread in order,
     * can be replied to, and goes away if the message is withdrawn.
     */
    public function createPoll(Request $request, Conversation $conversation, PollService $polls): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate([
            'question' => 'required|string|max:255',
            'options' => 'required|array|min:'.PollService::MIN_OPTIONS.'|max:'.PollService::MAX_OPTIONS,
            'options.*' => 'required|string|max:150',
            'allowMultiple' => 'nullable|boolean',
            'isAnonymous' => 'nullable|boolean',
            'closesAt' => 'nullable|date|after:now',
        ]);

        // Two options that read the same is a poll nobody can answer sensibly.
        $labels = array_map(fn ($o) => trim($o), $data['options']);
        if (count(array_unique(array_map('mb_strtolower', $labels))) !== count($labels)) {
            return response()->json(['message' => 'Each choice must be different.'], 422);
        }

        $poll = $polls->create(
            $me,
            $conversation,
            trim($data['question']),
            $labels,
            (bool) ($data['allowMultiple'] ?? false),
            (bool) ($data['isAnonymous'] ?? false),
            $data['closesAt'] ?? null,
        );

        return response()->json([
            'data' => $this->chat->presentWithPoll($poll->message()->first(), $me),
        ], 201);
    }

    /** Casts a vote, or takes one back by choosing the same option again. */
    public function vote(Request $request, Poll $poll, PollService $polls): JsonResponse
    {
        $me = $this->member($request, $poll->conversation);

        $data = $request->validate(['optionId' => 'required|integer']);

        if ($poll->isClosed()) {
            return response()->json(['message' => 'This poll has closed.'], 422);
        }

        $polls->vote($me, $poll, (int) $data['optionId']);

        return response()->json(['data' => $polls->present($poll->fresh(), $me)]);
    }

    /**
     * Closes a poll, or reopens one.
     *
     * The author may always. A group admin may too, because the person who
     * asked may have left, and a poll nobody can close stays open forever.
     */
    public function updatePoll(Request $request, Poll $poll, PollService $polls): JsonResponse
    {
        $me = $this->member($request, $poll->conversation);

        $data = $request->validate(['closed' => 'required|boolean']);

        if ($poll->created_by !== $me->id && ! $this->chat->isAdmin($me, $poll->conversation)) {
            throw new AccessDeniedHttpException('Only the person who asked, or a group admin, can close this poll.');
        }

        $updated = $data['closed'] ? $polls->close($poll) : $polls->reopen($poll);

        return response()->json(['data' => $polls->present($updated, $me)]);
    }

    /** One poll on its own — for a client refreshing results without the thread. */
    public function showPoll(Request $request, Poll $poll, PollService $polls): JsonResponse
    {
        $me = $this->member($request, $poll->conversation);

        return response()->json(['data' => $polls->present($poll, $me)]);
    }

    /* ====================================================================== */
    /* Membership */
    /* ====================================================================== */

    public function addMembers(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate([
            'userIds' => 'required|array|min:1',
            'userIds.*' => 'integer|exists:users,id',
        ]);

        if ($conversation->kind === 'direct') {
            throw new AccessDeniedHttpException('A direct conversation is between two people. Create a group instead.');
        }

        $added = $this->chat->addMembers($me, $conversation, $data['userIds']);

        return response()->json(['data' => ['added' => $added, 'conversation' => $this->room($conversation->refresh(), $me)]]);
    }

    /**
     * Removes somebody, or leaves.
     *
     * Anybody may remove themselves. Removing another person takes group admin,
     * so one member cannot quietly clear out a room they merely belong to.
     */
    public function removeMember(Request $request, Conversation $conversation, User $user): JsonResponse
    {
        $me = $this->member($request, $conversation);

        if ($conversation->kind === 'direct') {
            throw new AccessDeniedHttpException('A direct conversation cannot have members removed.');
        }
        if ($user->id !== $me->id && ! $this->chat->isAdmin($me, $conversation)) {
            throw new AccessDeniedHttpException('Only a group admin can remove another member.');
        }

        $this->chat->removeMember($me, $conversation, $user);

        return response()->json(['data' => ['removed' => $user->id, 'left' => $user->id === $me->id]]);
    }

    /** Who is in a room, and what each of them may do in it. */
    public function members(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        return response()->json([
            'data' => $conversation->participants()
                ->with('user:id,name,username,status,employee_id')
                ->get()
                ->map(fn ($p) => [
                    'id' => $p->user_id,
                    'name' => $p->user?->name ?? 'Removed user',
                    'role' => $p->role,
                    // Marked here rather than inferred client-side: "which of
                    // these rows is me" decides what Leave does, and guessing
                    // it from a matching role would sometimes pick a stranger.
                    'mine' => $p->user_id === $me->id,
                    'muted' => (bool) $p->muted,
                    'status' => $p->user?->status,
                    'joinedAt' => $p->joined_at?->toIso8601String(),
                ])
                ->values(),
        ]);
    }

    /* ====================================================================== */
    /* Guards */
    /* ====================================================================== */

    private function me(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }

    /**
     * Resolves the caller and proves they belong in the room.
     *
     * 404 rather than 403 on purpose: a room somebody is not in should not be
     * confirmable as existing at all.
     */
    /**
     * Says "still typing" and reports who else is.
     *
     * A stamp is written rather than a flag set, because a flag needs somebody
     * to clear it and the one moment you cannot rely on is the browser that
     * closed mid-sentence. Anything older than the window below is simply not
     * typing any more, which needs no cleanup job.
     */
    public function typing(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $conversation->participants()
            ->where('user_id', $me->id)
            ->update(['last_typing_at' => now()]);

        return response()->json(['data' => ['typing' => $this->chat->typingIn($conversation, $me)]]);
    }

    /**
     * Pins one message to the top of the room, or clears the pin.
     *
     * Every group thread ends up with one message that matters more than the
     * rest — an address, a cut-off, a decision — and it scrolls away within
     * the hour. One pin rather than a list: several would need an ordering and
     * a screen to manage it, and the case that actually comes up is one.
     */
    public function pin(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate(['messageId' => 'nullable|integer|exists:messages,id']);

        if (! empty($data['messageId'])) {
            $message = Message::find($data['messageId']);
            if (! $message || $message->conversation_id !== $conversation->id) {
                return response()->json(['message' => 'You can only pin a message from this conversation.'], 422);
            }
        }

        $conversation->update([
            'pinned_message_id' => $data['messageId'] ?? null,
            'pinned_by' => empty($data['messageId']) ? null : $me->id,
            'pinned_at' => empty($data['messageId']) ? null : now(),
        ]);

        return response()->json(['data' => $this->room($conversation->fresh(), $me)]);
    }

    /**
     * Sends an existing message on to another room.
     *
     * Copied rather than moved, and attributed to whoever forwarded it — the
     * alternative is a message appearing in a thread under the name of somebody
     * who is not in that thread, which is both confusing and a small privacy
     * leak. The original is quoted so the new room can see where it came from.
     */
    public function forward(Request $request, Message $message): JsonResponse
    {
        $me = $this->member($request, $message->conversation);

        if ($message->isWithdrawn()) {
            return response()->json(['message' => 'That message has been deleted.'], 422);
        }

        $data = $request->validate(['conversationId' => 'required|integer|exists:conversations,id']);

        $target = Conversation::find($data['conversationId']);
        $this->member($request, $target);

        $body = trim((string) $message->body);
        $forwarded = $this->chat->send($me, $target, $body === '' ? '(forwarded attachment)' : $body);

        // Attachments come along, pointing at the same file on disk rather
        // than a second copy of it.
        foreach ($message->attachments as $attachment) {
            MessageAttachment::create([
                'message_id' => $forwarded->id,
                'conversation_id' => $target->id,
                'user_id' => $me->id,
                'kind' => $attachment->kind,
                'disk_path' => $attachment->disk_path,
                'original_name' => $attachment->original_name,
                'mime' => $attachment->mime,
                'bytes' => $attachment->bytes,
                'width' => $attachment->width,
                'height' => $attachment->height,
            ]);
        }

        return response()->json(['data' => $this->chat->present($forwarded->fresh(), $me)], 201);
    }

    /**
     * Finds a message inside one conversation.
     *
     * Scoped to a room rather than searching everything, because that is how
     * people actually look for something — "it was in the dispatch thread,
     * some time last month". Withdrawn messages are excluded: a tombstone is
     * not a result.
     */
    public function searchMessages(Request $request, Conversation $conversation): JsonResponse
    {
        $me = $this->member($request, $conversation);

        $data = $request->validate(['q' => 'required|string|min:2|max:120']);

        $hits = Message::query()
            ->where('conversation_id', $conversation->id)
            ->whereNull('deleted_at')
            ->where('is_system', false)
            ->where('body', 'like', '%'.$data['q'].'%')
            ->with(['author:id,name', 'replyTo.author:id,name', 'reactions', 'attachments'])
            ->orderByDesc('id')
            ->limit(40)
            ->get()
            ->map(fn (Message $m) => $this->chat->present($m, $me))
            ->values();

        return response()->json(['data' => $hits]);
    }

    private function member(Request $request, ?Conversation $conversation): User
    {
        $me = $this->me($request);

        if (! $conversation || ! $this->chat->isMember($me, $conversation)) {
            abort(404, 'Conversation not found.');
        }

        return $me;
    }

    /** One room, shaped exactly like a row of the conversation list. */
    private function room(Conversation $conversation, User $me): array
    {
        $rooms = $this->chat->conversationsFor($me);

        return collect($rooms)->firstWhere('id', $conversation->id) ?? ['id' => $conversation->id];
    }
}
