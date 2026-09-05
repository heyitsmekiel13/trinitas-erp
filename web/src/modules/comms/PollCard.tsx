import * as React from 'react'
import { BarChart3, Check, EyeOff, Lock, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { setPollClosed, votePoll, type ChatPoll } from '@/lib/chatApi'
import { Tooltip } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'

/**
 * A poll inside the thread.
 *
 * Results are always visible rather than hidden until you answer. This is a
 * workplace, not a game show: people need to see that four colleagues already
 * said Friday before deciding whether Friday works for them too.
 *
 * The bar is drawn as a background fill behind the label rather than as a
 * separate track, so the option stays one clickable target and the row does
 * not change height when the first vote lands.
 */
function deadlineLabel(poll: ChatPoll): string | null {
  if (poll.closedAt) return 'Closed'
  if (!poll.closesAt) return null

  const closes = new Date(poll.closesAt).getTime()
  const minutes = Math.round((closes - Date.now()) / 60_000)

  if (minutes <= 0) return 'Closed'
  if (minutes < 60) return `Closes in ${minutes}m`
  if (minutes < 24 * 60) return `Closes in ${Math.round(minutes / 60)}h`

  return `Closes ${new Date(poll.closesAt).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })}`
}

export function PollCard({
  poll,
  /** True when the carrier message is the reader's own, which tints the card. */
  mine,
  onChanged,
}: {
  poll: ChatPoll
  mine: boolean
  onChanged: (poll: ChatPoll) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState<number | null>(null)

  const vote = async (optionId: number) => {
    if (poll.closed) return

    setBusy(optionId)
    try {
      onChanged(await votePoll(poll.id, optionId))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not record that vote.', description: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const toggleClosed = async () => {
    try {
      onChanged(await setPollClosed(poll.id, !poll.closed))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not change the poll.', description: (err as Error).message })
    }
  }

  const deadline = deadlineLabel(poll)
  // The leader, so it can be marked once voting is over.
  const topVotes = Math.max(0, ...poll.options.map((o) => o.votes))

  return (
    <div
      className={cn(
        'w-[min(88vw,22rem)] rounded-xl border p-3',
        mine ? 'border-white/25 bg-white/10' : 'border-line bg-surface',
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <BarChart3 className={cn('mt-0.5 size-4 shrink-0', mine ? 'text-white/80' : 'text-brand-500')} />
        <p className={cn('min-w-0 flex-1 text-[13px] leading-snug font-semibold', mine ? 'text-white' : 'text-ink')}>
          {poll.question}
        </p>
      </div>

      <ul className="space-y-1.5">
        {poll.options.map((option) => {
          const leading = poll.closed && option.votes > 0 && option.votes === topVotes

          return (
            <li key={option.id}>
              <button
                onClick={() => void vote(option.id)}
                disabled={poll.closed || busy !== null}
                aria-pressed={option.mine}
                className={cn(
                  'relative w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                  poll.closed ? 'cursor-default' : 'cursor-pointer',
                  option.mine
                    ? mine
                      ? 'border-white/60 bg-white/10'
                      : 'border-brand-400 bg-brand-50/60 dark:bg-brand-950/60'
                    : mine
                      ? 'border-white/20 hover:border-white/40'
                      : 'border-line hover:border-line-strong',
                )}
              >
                {/* The tally, as a fill behind the label. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-y-0 left-0 transition-[width] duration-500',
                    mine ? 'bg-white/15' : 'bg-brand-100/70 dark:bg-brand-900/40',
                  )}
                  style={{ width: `${option.share}%` }}
                />

                <span className="relative flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border',
                      // A square marker for multiple choice, round for single —
                      // the same convention as a checkbox against a radio.
                      poll.allowMultiple && 'rounded-[4px]',
                      option.mine
                        ? mine
                          ? 'border-white bg-white text-brand-600'
                          : 'grad-brand border-transparent text-white'
                        : mine
                          ? 'border-white/50'
                          : 'border-line-strong',
                    )}
                  >
                    {option.mine && <Check className="size-2.5" strokeWidth={3.5} />}
                  </span>

                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[12.5px]',
                      mine ? 'text-white' : 'text-ink',
                      (option.mine || leading) && 'font-semibold',
                    )}
                  >
                    {option.label}
                  </span>

                  {leading && (
                    <span className={cn('shrink-0 text-[10px] font-semibold', mine ? 'text-white/80' : 'text-good')}>
                      WON
                    </span>
                  )}

                  {/* Named voters, when the poll is not anonymous. */}
                  {option.voters.length > 0 ? (
                    <Tooltip content={option.voters.join(', ')}>
                      <span className={cn('shrink-0 text-[11px] tabular', mine ? 'text-white/80' : 'text-ink-3')}>
                        {option.votes}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className={cn('shrink-0 text-[11px] tabular', mine ? 'text-white/80' : 'text-ink-3')}>
                      {option.votes}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div
        className={cn(
          'mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]',
          mine ? 'text-white/75' : 'text-ink-3',
        )}
      >
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
        </span>

        {poll.allowMultiple && <span>· Choose more than one</span>}

        {poll.isAnonymous && (
          <span className="inline-flex items-center gap-1">
            <EyeOff className="size-3" />
            Anonymous
          </span>
        )}

        {deadline && (
          <span className="inline-flex items-center gap-1">
            {poll.closed && <Lock className="size-3" />}
            {deadline}
          </span>
        )}

        {/* Only the person who asked sees the control that ends it. Group
            admins may too, but the server is the one that decides. */}
        {poll.mine && (
          <button
            onClick={() => void toggleClosed()}
            className={cn('ml-auto font-semibold underline-offset-2 hover:underline', mine ? 'text-white' : 'text-brand-600')}
          >
            {poll.closed ? 'Reopen' : 'Close poll'}
          </button>
        )}
      </div>
    </div>
  )
}
