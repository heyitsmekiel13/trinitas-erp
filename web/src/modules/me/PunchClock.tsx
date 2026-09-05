import * as React from 'react'
import { Coffee, LogIn, LogOut, Timer, Undo2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { punchClock, type ClockAction, type ClockState } from '@/lib/adminApi'
import { PinPrompt, PinRequiredNotice, PinSetup } from './PinPad'
import { useToast } from '@/components/ui/feedback'

/**
 * The punch clock.
 *
 * Four presses make a day, and the server decides which are allowed — the
 * buttons read `can` rather than working it out again here, so the screen can
 * never offer something that will be refused.
 *
 * The card is deliberately the loudest thing on the page: for most of the
 * workforce this is the only screen in the ERP they will ever use, and it has
 * to be usable at arm's length on a shared terminal by someone in a hurry.
 */

const ACTIONS: {
  action: ClockAction
  label: string
  hint: string
  icon: typeof LogIn
  tone: 'in' | 'break' | 'back' | 'out'
}[] = [
  { action: 'in', label: 'Time In', hint: 'Start your day', icon: LogIn, tone: 'in' },
  { action: 'break-out', label: 'Break Out', hint: 'Going on break', icon: Coffee, tone: 'break' },
  { action: 'break-in', label: 'Break In', hint: 'Back from break', icon: Undo2, tone: 'back' },
  { action: 'out', label: 'Time Out', hint: 'End your day', icon: LogOut, tone: 'out' },
]

const OT_ACTIONS: {
  action: ClockAction
  label: string
  hint: string
  icon: typeof LogIn
  tone: 'in' | 'out'
}[] = [
  { action: 'ot-in', label: 'Start Overtime', hint: 'A separate stint, after a break', icon: Timer, tone: 'in' },
  { action: 'ot-out', label: 'End Overtime', hint: 'Wrap up your overtime', icon: LogOut, tone: 'out' },
]

const TONES: Record<string, string> = {
  in: 'from-emerald-500 to-emerald-600 shadow-emerald-500/30',
  break: 'from-amber-500 to-amber-600 shadow-amber-500/30',
  back: 'from-sky-500 to-sky-600 shadow-sky-500/30',
  out: 'from-rose-500 to-rose-600 shadow-rose-500/30',
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

/** A live wall clock, so the screen shows the time the punch will land at. */
function Now({ serverOffsetMs }: { serverOffsetMs: number }) {
  const [now, setNow] = React.useState(() => new Date(Date.now() + serverOffsetMs))

  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date(Date.now() + serverOffsetMs)), 1000)
    return () => clearInterval(id)
  }, [serverOffsetMs])

  return (
    <div className="text-center">
      <p className="tabular text-5xl font-bold tracking-tight text-ink sm:text-6xl">
        {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </p>
      <p className="mt-1 text-[13px] text-ink-3">
        {now.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  )
}

export function PunchClock({
  state,
  onPunched,
  onPinChanged,
  name,
  isManagerial,
}: {
  state: ClockState
  onPunched: (next: ClockState) => void
  /** Refetches the portal so `pinSet` reflects reality after setup. */
  onPinChanged?: () => void
  name?: string
  /**
   * Hides the overtime pair — a manager or supervisor works the hours the
   * job needs rather than a shift with a straight-overtime tail, so the
   * button pair only makes sense for rank and file. See `Employee.position`.
   */
  isManagerial?: boolean
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState<ClockAction | null>(null)
  const [pending, setPending] = React.useState<ClockAction | null>(null)
  const [setupOpen, setSetupOpen] = React.useState(false)
  const [pinAttempt, setPinAttempt] = React.useState(0)

  const needsPin = state.pinRequired && !state.pinSet

  // The server's clock is the one that counts, so the display follows it
  // rather than whatever the terminal thinks the time is.
  const serverOffsetMs = React.useMemo(
    () => new Date(state.serverTime).getTime() - Date.now(),
    [state.serverTime],
  )

  /**
   * A press asks for the PIN first when one is required.
   *
   * The punch itself only happens once the PIN is entered, so a colleague who
   * borrowed the shared password still cannot clock anybody in.
   */
  const press = (action: ClockAction) => {
    if (needsPin) {
      setSetupOpen(true)
      return
    }

    if (state.pinRequired) {
      setPending(action)
      return
    }

    void submit(action)
  }

  const submit = async (action: ClockAction, pin?: string) => {
    setBusy(action)
    try {
      const result = await punchClock(action, pin)
      const labels: Record<ClockAction, string> = {
        in: 'Timed in',
        'break-out': 'On break',
        'break-in': 'Back from break',
        out: 'Timed out',
        'ot-in': 'Overtime started',
        'ot-out': 'Overtime ended',
      }
      const fields: Record<ClockAction, keyof ClockState> = {
        in: 'clockIn',
        'break-out': 'breakOut',
        'break-in': 'breakIn',
        out: 'clockOut',
        'ot-in': 'otClockIn',
        'ot-out': 'otClockOut',
      }

      toast({
        tone: 'success',
        title: labels[action],
        description:
          action === 'out'
            ? `${result.record.hoursWorked} hours recorded${result.record.lateMinutes > 0 ? ` · ${result.record.lateMinutes} min late` : ''}.`
            : action === 'ot-out'
              ? `${result.clock.overtimeHours} hour(s) of overtime recorded.`
              : `Recorded at ${time(result.clock[fields[action]] as string | null)}.`,
      })
      onPunched(result.clock)
      setPending(null)
    } catch (e) {
      // The keypad stays open on a wrong PIN and empties itself, so the
      // employee simply retypes rather than starting the whole press again.
      toast({ tone: 'error', title: 'Could not record that', description: (e as Error).message })
      setPinAttempt((n) => n + 1)
    } finally {
      setBusy(null)
    }
  }

  const stageLabel = {
    off: 'Not yet timed in',
    working: 'On the clock',
    'on-break': 'On break',
    done: 'Timed out for today',
    'on-overtime': 'On overtime',
  }[state.stage]

  const stageTone = {
    off: 'bg-surface-3 text-ink-2',
    working: 'bg-good/15 text-good',
    'on-break': 'bg-warning/15 text-warning',
    done: 'bg-brand-500/10 text-brand-600 dark:text-brand-400',
    'on-overtime': 'bg-series-1/15 text-series-1',
  }[state.stage]

  const actionLabel: Record<ClockAction, string> = {
    in: 'time in',
    'break-out': 'start your break',
    'break-in': 'end your break',
    out: 'time out',
    'ot-in': 'start overtime',
    'ot-out': 'end overtime',
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_16px_48px_-24px_rgb(13_15_20/0.22)]">
      <div className="border-b border-line px-5 py-6 sm:px-7">
        {name && (
          <p className="mb-4 text-center text-[13px] text-ink-3">
            Good{' '}
            {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'},{' '}
            <span className="font-medium text-ink">{name}</span>
          </p>
        )}

        <Now serverOffsetMs={serverOffsetMs} />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className={cn('rounded-full px-3 py-1 text-[12px] font-medium', stageTone)}>{stageLabel}</span>
          {state.shift && (
            <span className="rounded-full bg-surface-3 px-3 py-1 text-[12px] text-ink-2">
              {state.shift.name}
            </span>
          )}
          {state.lateMinutes > 0 && (
            <span className="rounded-full bg-critical/10 px-3 py-1 text-[12px] font-medium text-critical">
              {state.lateMinutes} min late
            </span>
          )}
        </div>
      </div>

      {needsPin && (
        <div className="px-5 pt-5 sm:px-7">
          <PinRequiredNotice onSetUp={() => setSetupOpen(true)} />
        </div>
      )}

      {/* The four presses. Disabled rather than hidden, so the sequence is
          visible even when a step is not available yet. */}
      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
        {ACTIONS.map(({ action, label, hint, icon: Icon, tone }) => {
          const enabled = state.can[action]
          const loading = busy === action

          return (
            <button
              key={action}
              type="button"
              disabled={!enabled || busy !== null}
              onClick={() => press(action)}
              className={cn(
                'group relative flex items-center gap-4 rounded-2xl px-5 py-5 text-left transition-all duration-200',
                enabled
                  ? cn(
                      'bg-gradient-to-br text-white shadow-lg hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:shadow-md',
                      TONES[tone],
                    )
                  : 'cursor-not-allowed border border-line bg-surface-2 text-ink-3',
                loading && 'opacity-70',
              )}
            >
              <span
                className={cn(
                  'flex size-12 shrink-0 items-center justify-center rounded-xl transition-transform',
                  enabled ? 'bg-white/20 group-hover:scale-110' : 'bg-surface-3',
                )}
              >
                <Icon className="size-6" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold">{label}</span>
                <span className={cn('block text-[12px]', enabled ? 'text-white/80' : 'text-ink-3')}>
                  {loading ? 'Recording…' : hint}
                </span>
              </span>

              {enabled && (
                <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-white/70" aria-hidden />
              )}
            </button>
          )
        })}
      </div>

      {/* Overtime — a separate stint after the regular shift is closed out,
          distinct from staying straight through (which the server already
          counts automatically off the regular clock-out and needs no press
          of its own). Only shown once it is actually relevant, so a normal
          day's screen stays exactly as it was. */}
      {!isManagerial && (state.stage === 'done' || state.stage === 'on-overtime') && (
        <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-2 sm:p-7">
          {OT_ACTIONS.map(({ action, label, hint, icon: Icon, tone }) => {
            const enabled = state.can[action]
            const loading = busy === action

            return (
              <button
                key={action}
                type="button"
                disabled={!enabled || busy !== null}
                onClick={() => press(action)}
                className={cn(
                  'group relative flex items-center gap-4 rounded-2xl px-5 py-5 text-left transition-all duration-200',
                  enabled
                    ? cn(
                        'bg-gradient-to-br text-white shadow-lg hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:shadow-md',
                        TONES[tone],
                      )
                    : 'cursor-not-allowed border border-line bg-surface-2 text-ink-3',
                  loading && 'opacity-70',
                )}
              >
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-xl transition-transform',
                    enabled ? 'bg-white/20 group-hover:scale-110' : 'bg-surface-3',
                  )}
                >
                  <Icon className="size-6" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold">{label}</span>
                  <span className={cn('block text-[12px]', enabled ? 'text-white/80' : 'text-ink-3')}>
                    {loading ? 'Recording…' : hint}
                  </span>
                </span>

                {enabled && (
                  <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-white/70" aria-hidden />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Today's stamps, so the employee can check what was recorded. */}
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
        {[
          ['Time in', state.clockIn],
          ['Break out', state.breakOut],
          ['Break in', state.breakIn],
          ['Time out', state.clockOut],
          ...(state.otClockIn || state.otClockOut
            ? [['OT in', state.otClockIn], ['OT out', state.otClockOut]]
            : []),
        ].map(([label, value]) => (
          <div key={label as string} className="bg-surface px-4 py-3 text-center">
            <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">{label}</p>
            <p className={cn('tabular mt-1 text-[15px] font-semibold', value ? 'text-ink' : 'text-ink-3')}>
              {time(value as string | null)}
            </p>
          </div>
        ))}
      </div>

      {state.pinRequired && state.pinSet && (
        <div className="border-t border-line px-5 py-2.5 text-center sm:px-7">
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="text-[12px] text-ink-3 underline-offset-2 transition-colors hover:text-ink-2 hover:underline"
          >
            Change my PIN
          </button>
        </div>
      )}

      <PinPrompt
        open={pending !== null}
        length={state.pinLength}
        action={pending ? actionLabel[pending] : ''}
        busy={busy !== null}
        resetSignal={pinAttempt}
        onCancel={() => setPending(null)}
        onSubmit={(pin) => pending && submit(pending, pin)}
      />

      <PinSetup
        open={setupOpen}
        length={state.pinLength}
        hasExisting={state.pinSet}
        onClose={() => setSetupOpen(false)}
        onDone={() => onPinChanged?.()}
      />

      {state.stage === 'done' && (
        <div className="border-t border-line bg-surface-2 px-5 py-3 text-center text-[13px] text-ink-2 sm:px-7">
          <strong className="text-ink">{state.hoursWorked} hours</strong> worked today
          {state.breakMinutes > 0 && ` · ${state.breakMinutes} min break`}
          {state.overtimeHours > 0 && (
            <> · {state.overtimeHours} h overtime{state.overtimeIsLogged ? ' (logged)' : ' (automatic)'}</>
          )}
          {state.undertimeMinutes > 0 && ` · ${state.undertimeMinutes} min undertime`}
        </div>
      )}
    </section>
  )
}
