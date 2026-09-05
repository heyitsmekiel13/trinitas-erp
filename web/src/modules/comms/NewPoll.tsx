import * as React from 'react'
import { GripVertical, Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  createPoll,
  type ChatMessage,
} from '@/lib/chatApi'
import { Button, Field, Input, Switch } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Asking a question.
 *
 * Opens with two empty choices because a poll with fewer is not a poll, and
 * grows a fresh row as soon as the last one is typed into — so the common case
 * of three or four options never needs the Add button at all.
 */
const DEADLINES = [
  { label: 'No deadline', hours: 0 },
  { label: '1 hour', hours: 1 },
  { label: 'End of day', hours: 8 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
] as const

export function NewPoll({
  open,
  conversationId,
  conversationName,
  onClose,
  onCreated,
}: {
  open: boolean
  conversationId: number
  conversationName: string
  onClose: () => void
  /** The carrier message, poll attached, ready to drop into the thread. */
  onCreated: (message: ChatMessage) => void
}) {
  const toast = useToast()
  const [question, setQuestion] = React.useState('')
  const [options, setOptions] = React.useState<string[]>(['', ''])
  const [allowMultiple, setAllowMultiple] = React.useState(false)
  const [isAnonymous, setIsAnonymous] = React.useState(false)
  const [deadlineHours, setDeadlineHours] = React.useState(0)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setQuestion('')
    setOptions(['', ''])
    setAllowMultiple(false)
    setIsAnonymous(false)
    setDeadlineHours(0)
  }, [open])

  const setOption = (index: number, value: string) => {
    setOptions((prev) => {
      const next = [...prev]
      next[index] = value

      // Typing into the last row offers another, up to the ceiling.
      if (index === next.length - 1 && value.trim() && next.length < POLL_MAX_OPTIONS) {
        next.push('')
      }
      return next
    })
  }

  const removeOption = (index: number) =>
    setOptions((prev) => (prev.length <= POLL_MIN_OPTIONS ? prev : prev.filter((_, i) => i !== index)))

  const filled = options.map((o) => o.trim()).filter(Boolean)
  const duplicated =
    new Set(filled.map((o) => o.toLowerCase())).size !== filled.length

  const problem = !question.trim()
    ? 'Write a question.'
    : filled.length < POLL_MIN_OPTIONS
      ? `Give at least ${POLL_MIN_OPTIONS} choices.`
      : duplicated
        ? 'Each choice must be different.'
        : null

  const submit = async () => {
    if (problem) return

    setBusy(true)
    try {
      const message = await createPoll(conversationId, {
        question: question.trim(),
        options: filled,
        allowMultiple,
        isAnonymous,
        ...(deadlineHours
          ? { closesAt: new Date(Date.now() + deadlineHours * 3_600_000).toISOString() }
          : {}),
      })

      onCreated(message)
      onClose()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not create that poll.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New poll"
      description={`Everyone in ${conversationName} can answer.`}
      size="md"
      dirty={Boolean(question.trim() || filled.length)}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ink-3">{problem}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={Boolean(problem) || busy}>
            {busy ? 'Posting…' : 'Post poll'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Question" required>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Which day works for the stock count?"
            maxLength={255}
            autoFocus
          />
        </Field>

        <Field label="Choices" hint={`Between ${POLL_MIN_OPTIONS} and ${POLL_MAX_OPTIONS}.`} composite>
          <ul className="space-y-1.5">
            {options.map((option, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <GripVertical className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <Input
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                  placeholder={`Choice ${index + 1}`}
                  maxLength={150}
                  aria-label={`Choice ${index + 1}`}
                  className="flex-1"
                />
                <button
                  onClick={() => removeOption(index)}
                  disabled={options.length <= POLL_MIN_OPTIONS}
                  className={cn(
                    'shrink-0 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink',
                    options.length <= POLL_MIN_OPTIONS && 'invisible',
                  )}
                  aria-label={`Remove choice ${index + 1}`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>

          {options.length < POLL_MAX_OPTIONS && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5"
              onClick={() => setOptions((prev) => [...prev, ''])}
            >
              <Plus className="size-3.5" />
              Add choice
            </Button>
          )}
        </Field>

        <Field label="Settings" composite>
          <div className="space-y-1.5">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="text-[13px] text-ink-2">
                Allow more than one choice
                <span className="mt-0.5 block text-[11px] text-ink-3">
                  For questions like “which shifts can you cover?”
                </span>
              </span>
              <Switch checked={allowMultiple} onChange={setAllowMultiple} label="Allow more than one choice" />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="text-[13px] text-ink-2">
                Anonymous
                <span className="mt-0.5 block text-[11px] text-ink-3">
                  Counts are shown; who voted is never recorded in the result.
                </span>
              </span>
              <Switch checked={isAnonymous} onChange={setIsAnonymous} label="Anonymous" />
            </label>
          </div>
        </Field>

        <Field label="Closes" hint="After this, the poll stops taking votes." composite>
          <div className="flex flex-wrap gap-1.5">
            {DEADLINES.map((d) => (
              <button
                key={d.label}
                onClick={() => setDeadlineHours(d.hours)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
                  deadlineHours === d.hours
                    ? 'border-brand-400 bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'border-line text-ink-2 hover:border-line-strong',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}
