import * as React from 'react'
import { Check, CornerUpLeft, Download, Forward, Paperclip, Pencil, Pin, SmilePlus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { REACTION_CHOICES, attachmentSrc, type ChatMessage, type ChatPoll } from '@/lib/chatApi'
import { Avatar, Button, Tooltip } from '@/components/ui/primitives'
import { PollCard } from './PollCard'

/** Time only — the day is already announced by the divider above the group. */
const clockTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''

/** A system line: joins, renames, departures. Centred, no bubble, no author. */
function SystemLine({ message }: { message: ChatMessage }) {
  return (
    <li className="my-2 flex justify-center">
      <span className="rounded-full bg-surface-3 px-3 py-1 text-[11px] text-ink-3">
        {message.body} · {clockTime(message.at)}
      </span>
    </li>
  )
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
      {REACTION_CHOICES.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onPick(emoji)}
          className="rounded-full px-1 text-base leading-none transition-transform hover:scale-125"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

export function MessageBubble({
  message,
  /** True when the line above is from the same person — hides the repeat header. */
  grouped,
  /** Rooms with more than two people need to say who is speaking. */
  showAuthor,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onPin,
  onForward,
  onJumpTo,
  onPollChanged,
}: {
  message: ChatMessage
  grouped: boolean
  showAuthor: boolean
  onReply: (message: ChatMessage) => void
  onReact: (message: ChatMessage, emoji: string | null) => void
  onEdit: (message: ChatMessage, body: string) => Promise<void>
  onDelete: (message: ChatMessage, scope: 'me' | 'everyone') => void
  onPin: (message: ChatMessage) => void
  onForward: (message: ChatMessage) => void
  onJumpTo: (id: number) => void
  /** A vote landed — hand the refreshed poll back to the thread. */
  onPollChanged: (message: ChatMessage, poll: ChatPoll) => void
}) {
  const [picking, setPicking] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(message.body ?? '')
  const [saving, setSaving] = React.useState(false)

  if (message.isSystem) return <SystemLine message={message} />

  const mine = message.mine

  const saveEdit = async () => {
    const next = draft.trim()
    if (!next || next === message.body) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onEdit(message, next)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li
      id={`message-${message.id}`}
      className={cn('group/msg flex gap-2 px-1', mine ? 'flex-row-reverse' : 'flex-row', grouped ? 'mt-0.5' : 'mt-3')}
    >
      {/* The avatar column keeps its width even when grouped, so consecutive
          bubbles from one person stay aligned rather than stepping inward. */}
      <div className="w-7 shrink-0">
        {!grouped && !mine && <Avatar name={message.author} size="sm" />}
      </div>

      {/* A poll card has its own fixed width, so the bubble's usual ceiling
          would squeeze it on a narrow screen. */}
      <div
        className={cn(
          'flex min-w-0 flex-col',
          message.poll ? 'max-w-full' : 'max-w-[min(78%,34rem)]',
          mine ? 'items-end' : 'items-start',
        )}
      >
        {!grouped && showAuthor && !mine && (
          <span className="mb-0.5 px-1 text-[11px] font-medium text-ink-3">{message.author}</span>
        )}

        <div className={cn('flex items-center gap-1', mine ? 'flex-row-reverse' : 'flex-row')}>
          {/* ---------------------------------------------------- the bubble */}
          <div
            className={cn(
              'relative rounded-2xl text-[13px] leading-relaxed break-words',
              // A poll brings its own card and padding; doubling it up would
              // draw a box inside a box.
              message.poll && !message.withdrawn ? 'p-1' : 'px-3 py-2',
              message.withdrawn
                ? 'border border-dashed border-line text-ink-3 italic'
                : mine
                  ? 'grad-brand text-white'
                  : 'bg-surface-3 text-ink',
              // Squared inner corner marks where the tail would be, and only
              // on the last bubble of a run — the same shape Messenger uses.
              !grouped && (mine ? 'rounded-br-md' : 'rounded-bl-md'),
            )}
          >
            {message.replyTo && !message.withdrawn && (
              <button
                onClick={() => onJumpTo(message.replyTo!.id)}
                className={cn(
                  'mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-[11px] leading-snug',
                  mine ? 'border-white/50 bg-white/15 text-white/85' : 'border-brand-400 bg-surface text-ink-3',
                )}
              >
                <span className="block font-medium">{message.replyTo.author ?? 'Removed user'}</span>
                <span className="line-clamp-2 opacity-90">
                  {message.replyTo.withdrawn ? 'This message was deleted' : message.replyTo.body}
                </span>
              </button>
            )}

            {message.withdrawn ? (
              <span>This message was deleted</span>
            ) : message.poll ? (
              // The poll replaces the body: the carrier message's text is the
              // same question, and printing it twice reads like a stutter.
              <PollCard
                poll={message.poll}
                mine={mine}
                onChanged={(poll) => onPollChanged(message, poll)}
              />
            ) : editing ? (
              <div className="flex flex-col gap-1.5">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void saveEdit()
                    }
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  rows={2}
                  autoFocus
                  className={cn(
                    'w-56 resize-none rounded-lg px-2 py-1 text-[13px] outline-none',
                    mine ? 'bg-white/20 text-white placeholder:text-white/60' : 'bg-surface text-ink',
                  )}
                />
                <div className="flex justify-end gap-1">
                  <button onClick={() => setEditing(false)} aria-label="Cancel edit" className="rounded p-1 opacity-80 hover:opacity-100">
                    <X className="size-3.5" />
                  </button>
                  <button onClick={() => void saveEdit()} disabled={saving} aria-label="Save edit" className="rounded p-1 opacity-80 hover:opacity-100">
                    <Check className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Pictures inline, everything else as a chip.
                    Images carry their real dimensions so the bubble holds the
                    right shape while the file is still arriving — otherwise
                    the whole thread jumps the moment a photo lands. */}
                {message.attachments?.length > 0 && (
                  <div className={cn('flex flex-wrap gap-1.5', message.body && 'mb-1.5')}>
                    {message.attachments.map((file) =>
                      file.kind === 'image' ? (
                        <a
                          key={file.id}
                          href={attachmentSrc(file.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="block"
                        >
                          <img
                            src={attachmentSrc(file.url)}
                            alt={file.name}
                            width={file.width ?? undefined}
                            height={file.height ?? undefined}
                            className="max-h-56 w-auto max-w-full rounded-lg object-cover"
                          />
                        </a>
                      ) : file.kind === 'video' ? (
                        <video
                          key={file.id}
                          src={attachmentSrc(file.url)}
                          controls
                          playsInline
                          className="max-h-56 max-w-full rounded-lg"
                        />
                      ) : file.kind === 'audio' ? (
                        <audio key={file.id} src={attachmentSrc(file.url)} controls className="w-56" />
                      ) : (
                        <a
                          key={file.id}
                          href={attachmentSrc(file.url)}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            'flex max-w-[14rem] items-center gap-2 rounded-lg px-2.5 py-2 transition-colors',
                            mine ? 'bg-white/15 hover:bg-white/25' : 'bg-surface-3 hover:bg-surface',
                          )}
                        >
                          <Paperclip className="size-3.5 shrink-0 opacity-70" />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium">{file.name}</span>
                            <span className="block text-[10px] opacity-70">{file.size}</span>
                          </span>
                          <Download className="size-3.5 shrink-0 opacity-70" />
                        </a>
                      ),
                    )}
                  </div>
                )}
                {message.body && <span className="whitespace-pre-wrap">{message.body}</span>}
              </>
            )}
          </div>

          {/* ------------------------------------------- hover action cluster */}
          {!message.withdrawn && !editing && (
            <div className="relative flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
              <Tooltip content="React">
                <Button variant="ghost" size="icon-sm" onClick={() => setPicking((p) => !p)} aria-label="React to message">
                  <SmilePlus className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Reply">
                <Button variant="ghost" size="icon-sm" onClick={() => onReply(message)} aria-label="Reply to message">
                  <CornerUpLeft className="size-3.5" />
                </Button>
              </Tooltip>
              {/* Not offered on a poll: its body only mirrors the question,
                  so editing it would change the line without changing the
                  poll anybody is actually answering. */}
              {message.canEdit && !message.poll && (
                <Tooltip content="Edit">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setDraft(message.body ?? '')
                      setEditing(true)
                    }}
                    aria-label="Edit message"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </Tooltip>
              )}
              <Tooltip content="Pin to the top">
                <Button variant="ghost" size="icon-sm" onClick={() => onPin(message)} aria-label="Pin message">
                  <Pin className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Forward to another chat">
                <Button variant="ghost" size="icon-sm" onClick={() => onForward(message)} aria-label="Forward message">
                  <Forward className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content={message.canWithdraw ? 'Delete' : 'Remove for me'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(message, message.canWithdraw ? 'everyone' : 'me')}
                  aria-label="Delete message"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>

              {picking && (
                <div className={cn('absolute bottom-full z-20 mb-1', mine ? 'right-0' : 'left-0')}>
                  <ReactionPicker
                    onPick={(emoji) => {
                      setPicking(false)
                      onReact(message, emoji)
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* --------------------------------------------------------- footer */}
        {message.reactions.length > 0 && (
          <div className={cn('-mt-1 flex flex-wrap gap-1 px-1', mine && 'justify-end')}>
            {message.reactions.map((r) => (
              <Tooltip key={r.emoji} content={r.by.join(', ')}>
                <button
                  onClick={() => onReact(message, r.mine ? null : r.emoji)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors',
                    r.mine
                      ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300'
                      : 'border-line bg-surface text-ink-3 hover:bg-surface-3',
                  )}
                >
                  <span>{r.emoji}</span>
                  {r.count > 1 && <span>{r.count}</span>}
                </button>
              </Tooltip>
            ))}
          </div>
        )}

        <span className="mt-0.5 px-1 text-[10px] text-ink-3">
          {clockTime(message.at)}
          {message.editedAt && !message.withdrawn && ' · edited'}
        </span>
      </div>
    </li>
  )
}
