<?php

namespace App\Services;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\Poll;
use App\Models\PollOption;
use App\Models\PollVote;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Polls inside a conversation.
 *
 * The rules worth stating, all enforced here so no endpoint can skip one:
 *
 *   - A poll is attached to a message, so it sits in the thread where it was
 *     asked and disappears with it.
 *   - A single-choice poll replaces the voter's previous answer rather than
 *     adding to it; changing your mind is normal and should not need an undo.
 *   - A closed poll accepts no votes. Closed means somebody closed it *or* its
 *     deadline passed — both, always, via Poll::isClosed().
 *   - An anonymous poll still records who voted, because that is the only way
 *     to stop one person voting twice. It simply never reports it. The names
 *     are withheld at the source, not hidden in the client.
 */
class PollService
{
    public const MAX_OPTIONS = 10;

    public const MIN_OPTIONS = 2;

    /**
     * Asks a question in a conversation.
     *
     * @param  array<int, string>  $options
     */
    public function create(
        User $author,
        Conversation $conversation,
        string $question,
        array $options,
        bool $allowMultiple = false,
        bool $isAnonymous = false,
        ?string $closesAt = null,
    ): Poll {
        return DB::transaction(function () use ($author, $conversation, $question, $options, $allowMultiple, $isAnonymous, $closesAt) {
            // The carrier line. Its body is what a client too old to render a
            // poll would show, and what the conversation list previews.
            $message = Message::create([
                'conversation_id' => $conversation->id,
                'user_id' => $author->id,
                'body' => "📊 {$question}",
            ]);

            $conversation->update(['last_message_at' => $message->created_at]);

            // Asking is also reading — the author's own poll must not come
            // back to them as unread.
            $conversation->participants()
                ->where('user_id', $author->id)
                ->update(['last_read_message_id' => $message->id]);

            $poll = Poll::create([
                'message_id' => $message->id,
                'conversation_id' => $conversation->id,
                'created_by' => $author->id,
                'question' => $question,
                'allow_multiple' => $allowMultiple,
                'is_anonymous' => $isAnonymous,
                'closes_at' => $closesAt,
            ]);

            foreach (array_values($options) as $position => $label) {
                $poll->options()->create([
                    'label' => $label,
                    'position' => $position,
                ]);
            }

            return $poll->load('options');
        });
    }

    /**
     * Records a vote, or takes one back.
     *
     * Passing an option the voter already backs removes it — the same tap that
     * cast it, which is how every poll UI behaves.
     */
    public function vote(User $voter, Poll $poll, int $optionId): Poll
    {
        $option = $poll->options()->findOrFail($optionId);

        DB::transaction(function () use ($voter, $poll, $option) {
            $existing = PollVote::where('poll_option_id', $option->id)
                ->where('user_id', $voter->id)
                ->first();

            if ($existing) {
                $existing->delete();

                return;
            }

            // Single choice: this answer replaces whatever they said before.
            if (! $poll->allow_multiple) {
                PollVote::where('poll_id', $poll->id)
                    ->where('user_id', $voter->id)
                    ->delete();
            }

            PollVote::create([
                'poll_id' => $poll->id,
                'poll_option_id' => $option->id,
                'user_id' => $voter->id,
            ]);
        });

        return $poll->fresh(['options']);
    }

    /** Ends a poll early. Only the author or a group admin may. */
    public function close(Poll $poll): Poll
    {
        $poll->update(['closed_at' => now()]);

        return $poll->fresh(['options']);
    }

    /** Reopens a poll that was closed by hand, clearing any lapsed deadline. */
    public function reopen(Poll $poll): Poll
    {
        $poll->update([
            'closed_at' => null,
            // A deadline already in the past would close it again immediately.
            'closes_at' => $poll->closes_at?->isPast() ? null : $poll->closes_at,
        ]);

        return $poll->fresh(['options']);
    }

    /**
     * The poll as one reader should see it.
     *
     * @return array<string, mixed>
     */
    public function present(Poll $poll, User $me): array
    {
        $poll->loadMissing(['options', 'author:id,name']);

        $votes = PollVote::where('poll_id', $poll->id)
            ->with('user:id,name')
            ->get();

        $byOption = $votes->groupBy('poll_option_id');
        // How many people took part — not how many boxes were ticked, which on
        // a multiple-choice poll is a larger and much less useful number.
        $voterCount = $votes->pluck('user_id')->unique()->count();
        $closed = $poll->isClosed();

        $options = $poll->options->map(function (PollOption $option) use ($byOption, $voterCount, $poll, $me) {
            $cast = $byOption->get($option->id, collect());

            return [
                'id' => $option->id,
                'label' => $option->label,
                'votes' => $cast->count(),
                // Share of participants, so a multiple-choice poll's bars are
                // read against people rather than against ticks.
                'share' => $voterCount > 0 ? round($cast->count() / $voterCount * 100) : 0,
                'mine' => $cast->contains('user_id', $me->id),
                // Withheld at the source on an anonymous poll.
                'voters' => $poll->is_anonymous
                    ? []
                    : $cast->map(fn (PollVote $v) => $v->user?->name)->filter()->values(),
            ];
        });

        return [
            'id' => $poll->id,
            'messageId' => $poll->message_id,
            'question' => $poll->question,
            'allowMultiple' => (bool) $poll->allow_multiple,
            'isAnonymous' => (bool) $poll->is_anonymous,
            'closed' => $closed,
            'closesAt' => $poll->closes_at?->toIso8601String(),
            'closedAt' => $poll->closed_at?->toIso8601String(),
            'author' => $poll->author?->name,
            'authorId' => $poll->created_by,
            'mine' => $poll->created_by === $me->id,
            'totalVoters' => $voterCount,
            'hasVoted' => $votes->contains('user_id', $me->id),
            'options' => $options->values(),
        ];
    }

    /**
     * The still-open polls in a conversation, keyed by message id.
     *
     * The thread's poll endpoint only returns messages nobody has seen yet,
     * which would never refresh a tally on a poll that is already on screen —
     * you would watch your own vote land and never anybody else's. This is the
     * small extra payload that fixes it, limited to polls still taking votes
     * because a closed one cannot change.
     *
     * @return array<int, array<string, mixed>>
     */
    public function openIn(Conversation $conversation, User $me, int $limit = 20): array
    {
        $polls = Poll::where('conversation_id', $conversation->id)
            ->whereNull('closed_at')
            ->where(fn ($q) => $q->whereNull('closes_at')->orWhere('closes_at', '>', now()))
            ->with(['options', 'author:id,name'])
            ->latest('id')
            ->limit($limit)
            ->get();

        $presented = [];
        foreach ($polls as $poll) {
            $presented[$poll->message_id] = $this->present($poll, $me);
        }

        return $presented;
    }

    /**
     * Presents every poll carried by a page of messages, keyed by message id.
     *
     * One query for the page rather than one per message — a thread of forty
     * lines should not cost forty round trips because three of them are polls.
     *
     * @param  array<int, int>  $messageIds
     * @return array<int, array<string, mixed>>
     */
    public function forMessages(array $messageIds, User $me): array
    {
        if (! $messageIds) {
            return [];
        }

        $polls = Poll::whereIn('message_id', $messageIds)
            ->with(['options', 'author:id,name'])
            ->get();

        $presented = [];
        foreach ($polls as $poll) {
            $presented[$poll->message_id] = $this->present($poll, $me);
        }

        return $presented;
    }
}
