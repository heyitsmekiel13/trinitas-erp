import { AlertTriangle, ArrowRight, Bell, CalendarClock, Mail, ShieldAlert, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Card } from '@/components/ui/primitives'

/**
 * What the system chases, and when.
 *
 * Read-only on purpose, and that is a design decision worth defending. Monday
 * and ClickUp both ship automation builders; in practice a handful of rules do
 * ninety per cent of the work, and a builder means every team writes their own
 * slightly different version of those same rules — then nobody can say what
 * the system will do, which is the one thing a reminder engine has to be
 * trusted about.
 *
 * So the escalation ladder is fixed and stated here in full. What a project
 * does control is its SLA, on the project itself, which is the number that
 * actually varies between teams.
 */

const LADDER = [
  {
    icon: Bell,
    when: 'A task is assigned to somebody',
    who: 'The assignee',
    what: 'An email naming the task, its project and its deadline.',
    tone: 'neutral' as const,
  },
  {
    icon: CalendarClock,
    when: 'Three days before the deadline',
    who: 'The assignee, the person who raised it, and any watchers',
    what: 'A heads-up, once.',
    tone: 'neutral' as const,
  },
  {
    icon: CalendarClock,
    when: 'One day before the deadline',
    who: 'The same people',
    what: 'A second heads-up.',
    tone: 'neutral' as const,
  },
  {
    icon: AlertTriangle,
    when: 'On the day it is due',
    who: 'The same people',
    what: '"Due today", sent in the 07:00 run so it can still be acted on.',
    tone: 'warning' as const,
  },
  {
    icon: AlertTriangle,
    when: 'Every day it stays overdue, for the first week',
    who: 'The same people',
    what: 'A daily chase, numbered, so the reader can see it is the fourth one.',
    tone: 'critical' as const,
  },
  {
    icon: Mail,
    when: 'After the first week, every third day',
    who: 'The same people',
    what: 'The chase slows down. A daily email forever becomes a filter rule, and then it is not a chase at all.',
    tone: 'critical' as const,
  },
  {
    icon: ShieldAlert,
    when: 'Every third day overdue, from day three',
    who: 'The project owner and the Process & Performance office',
    what: 'An escalation. Chasing the assignee has demonstrably not worked, so it goes to people who can do something else about it.',
    tone: 'critical' as const,
  },
] as const

const TONE_STYLE = {
  neutral: 'text-ink-3',
  warning: 'text-warning',
  critical: 'text-critical',
}

const GUARANTEES = [
  {
    title: 'At most one email per person, per kind, per task, per day',
    body: 'Enforced by a unique index on the notice table rather than by a timer in the code, so the nightly job and the "remind now" button cannot double up on each other — and a cron that fires twice sends once.',
  },
  {
    title: 'Reminders stop when the task is finished, and only then',
    body: 'There is no snooze and no dismiss. The way to stop being chased is to move the card into the finished column, which is also how the compliance register learns that it landed.',
  },
  {
    title: 'A task raised without a deadline still gets one',
    body: 'It inherits the project SLA in working days. "No date" is the quietest way for work to escape being measured, so it is not available by default.',
  },
  {
    title: 'Every notice is written to the email log',
    body: 'Admin → Email log shows whether each one actually left the building. "Did they get the reminder?" is answerable without reading server logs.',
  },
]

export function Automations() {
  return (
    <>
      <PageHeader
        title="Rules & Reminders"
        description="Exactly what the system will do about a deadline, and who it tells. Fixed rather than configurable — a chase nobody can predict is a chase nobody trusts."
        meta={<Badge tone="neutral">Runs daily · 06:30 scan · 07:00 email</Badge>}
      />

      <Card className="mb-4 overflow-hidden p-0">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold text-ink">The escalation ladder</h2>
          <p className="text-[11px] text-ink-3">Top to bottom, in the order a task travels through it.</p>
        </header>

        <ol className="divide-y divide-line">
          {LADDER.map((step, i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0">
                <step.icon className={`size-4 ${TONE_STYLE[step.tone]}`} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] font-medium text-ink">{step.when}</span>
                  <ArrowRight className="size-3 text-ink-3" />
                  <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
                    <Users className="size-3 text-ink-3" />
                    {step.who}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{step.what}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {GUARANTEES.map((item) => (
          <Card key={item.title} className="p-4">
            <h3 className="text-[13px] font-semibold text-ink">{item.title}</h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{item.body}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-4">
        <h3 className="text-[13px] font-semibold text-ink">What a project controls</h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
          One number: the default deadline, in working days, set when the project is created and editable afterwards. A
          task raised without its own date inherits it. Everything above is deliberately the same for every project, so
          that a person on four projects is chased in one predictable way rather than four.
        </p>
      </Card>

      <p className="mt-4 text-center text-[11px] text-ink-3">
        Both jobs need one cron entry on the server:
        <code className="ml-1.5 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
          * * * * * php artisan schedule:run
        </code>
      </p>
    </>
  )
}
