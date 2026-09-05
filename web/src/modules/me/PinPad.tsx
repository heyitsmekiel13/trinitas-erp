import * as React from 'react'
import { Delete, KeyRound, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { setPunchPin } from '@/lib/adminApi'
import { Button, Field } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * The PIN, entered on a keypad.
 *
 * A keypad rather than a text field because this is pressed on a shared
 * terminal, often standing up, often on a phone — and because a numeric keyboard
 * is not guaranteed to appear for a text input.
 *
 * The PIN is what makes a punch belong to somebody. The account password cannot
 * do that job: it is shared by design so people can sign in easily.
 */

function Keypad({
  value,
  length,
  onChange,
  autoFocus,
}: {
  value: string
  length: number
  onChange: (next: string) => void
  autoFocus?: boolean
}) {
  const press = (digit: string) => {
    if (value.length < length) onChange(value + digit)
  }

  // Physical keyboards should still work — a desk terminal has one. The
  // dependency list matters: without it this re-subscribes on every render.
  React.useEffect(() => {
    if (!autoFocus) return

    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') onChange(value.slice(0, -1))
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, value, length])

  return (
    <div>
      {/* Filled dots rather than digits: a PIN typed at a shared terminal is
          read over the shoulder more often than anyone expects. */}
      <div className="mb-5 flex justify-center gap-3" aria-label={`${value.length} of ${length} digits entered`}>
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'size-4 rounded-full border-2 transition-all',
              i < value.length ? 'scale-110 border-brand-500 bg-brand-500' : 'border-line-strong bg-transparent',
            )}
          />
        ))}
      </div>

      <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="h-14 rounded-xl border border-line bg-surface-2 text-[20px] font-semibold text-ink transition-all hover:border-brand-400 hover:bg-surface-3 active:scale-95"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          type="button"
          onClick={() => press('0')}
          className="h-14 rounded-xl border border-line bg-surface-2 text-[20px] font-semibold text-ink transition-all hover:border-brand-400 hover:bg-surface-3 active:scale-95"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="Delete last digit"
          className="flex h-14 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-2 transition-all hover:border-brand-400 hover:bg-surface-3 active:scale-95"
        >
          <Delete className="size-5" />
        </button>
      </div>
    </div>
  )
}

/** Asked for at the moment of punching. */
export function PinPrompt({
  open,
  length,
  action,
  busy,
  resetSignal,
  onCancel,
  onSubmit,
}: {
  open: boolean
  length: number
  action: string
  busy: boolean
  /** Bumped by the caller after a rejected PIN, to clear the keypad. */
  resetSignal?: number
  onCancel: () => void
  onSubmit: (pin: string) => void
}) {
  const [pin, setPin] = React.useState('')

  React.useEffect(() => {
    if (open) setPin('')
  }, [open])

  // A wrong PIN empties the keypad rather than leaving four filled dots the
  // employee has to backspace through before trying again.
  React.useEffect(() => {
    if (resetSignal) setPin('')
  }, [resetSignal])

  // Submitting itself once the last digit lands keeps the interaction to
  // exactly four presses, which is what makes this usable at a shift change.
  React.useEffect(() => {
    if (length > 0 && pin.length === length && !busy) onSubmit(pin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, length])

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={`Enter your PIN to ${action}`}
      description="Your PIN — not the password everyone signs in with."
      footer={
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      }
    >
      {open && <Keypad value={pin} length={length} onChange={setPin} autoFocus />}
      {busy && <p className="mt-4 text-center text-[13px] text-ink-3">Recording…</p>}
    </Modal>
  )
}

/** First-time setup, and changing it later. */
export function PinSetup({
  open,
  length,
  hasExisting,
  onClose,
  onDone,
}: {
  open: boolean
  length: number
  hasExisting: boolean
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [step, setStep] = React.useState<'current' | 'new' | 'confirm'>(hasExisting ? 'current' : 'new')
  const [current, setCurrent] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setStep(hasExisting ? 'current' : 'new')
    setCurrent('')
    setPin('')
    setConfirm('')
  }, [open, hasExisting])

  const save = React.useCallback(
    async (confirmed: string) => {
      setBusy(true)
      try {
        await setPunchPin(pin, hasExisting ? current : undefined)
        toast({
          tone: 'success',
          title: 'PIN saved',
          description: 'You will be asked for it every time you clock in or out.',
        })
        onDone()
        onClose()
      } catch (e) {
        toast({ tone: 'error', title: 'Could not save your PIN', description: (e as Error).message })
        setStep('new')
        setPin('')
        setConfirm('')
      } finally {
        setBusy(false)
        void confirmed
      }
    },
    [pin, current, hasExisting, toast, onDone, onClose],
  )

  React.useEffect(() => {
    if (length > 0 && step === 'current' && current.length === length) setStep('new')
  }, [current, length, step])

  React.useEffect(() => {
    if (length > 0 && step === 'new' && pin.length === length) setStep('confirm')
  }, [pin, length, step])

  React.useEffect(() => {
    if (length <= 0 || step !== 'confirm' || confirm.length !== length) return

    if (confirm !== pin) {
      toast({ tone: 'error', title: 'Those did not match', description: 'Try again.' })
      setPin('')
      setConfirm('')
      setStep('new')
      return
    }

    void save(confirm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm, pin, length, step])

  const { title, description, value, setValue } = {
    current: {
      title: 'Enter your current PIN',
      description: 'Needed before you can change it.',
      value: current,
      setValue: setCurrent,
    },
    new: {
      title: hasExisting ? 'Choose a new PIN' : 'Choose your PIN',
      description: `${length} digits. Avoid a run like 1234, a repeat like 1111, or anything from your employee number — the system will refuse those.`,
      value: pin,
      setValue: setPin,
    },
    confirm: {
      title: 'Enter it again',
      description: 'Just to be sure you will remember it.',
      value: confirm,
      setValue: setConfirm,
    },
  }[step]

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      }
    >
      {open && <Keypad value={value} length={length} onChange={setValue} autoFocus />}

      {step === 'new' && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-surface-2 p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <p className="text-[12px] leading-relaxed text-ink-2">
            This is yours alone. Everyone signs in with the same password, so your PIN is the only thing that makes a
            time record actually yours. Giving it to somebody else so they can clock you in is a disciplinary matter.
          </p>
        </div>
      )}

      {busy && <p className="mt-4 text-center text-[13px] text-ink-3">Saving…</p>}
    </Modal>
  )
}

/** The banner that appears until somebody has set one. */
export function PinRequiredNotice({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
      <KeyRound className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-[13px] text-ink-2">
        <strong className="text-ink">Set your punch PIN.</strong> You cannot clock in until you do — it is what proves
        the time record is yours.
      </p>
      <Button variant="primary" size="sm" onClick={onSetUp}>
        Set my PIN
      </Button>
    </div>
  )
}

/** Used by <Field> consumers that want the keypad inline. */
export { Keypad, Field }
