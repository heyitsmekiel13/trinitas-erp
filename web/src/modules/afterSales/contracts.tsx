import * as React from 'react'
import { CalendarClock, FileCheck, Plus, Repeat, ShieldCheck, TrendingUp, Wallet } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, money, num } from '@/lib/format'
import { exportCsv } from '@/lib/export'
import { CLIENT_TYPES, EQUIPMENT_TYPES, type EquipmentType } from '@/data/afterSales'
import { dateKey } from '@/data/scheduling'
import {
  CONTRACT_FREQUENCIES,
  COVERAGE_LEVELS,
  contractDueDates,
  frequencyMonths,
  type ContractFrequency,
  type CoverageLevel,
  type ServiceContract,
} from '@/data/serviceQuality'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, CardHeader, Input, Select, Switch, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { useSchedule } from './schedule'

/**
 * Service agreements — the recurring half of an after-sales business.
 *
 * `PMS` was already one of the revenue columns and one of the repair types,
 * which tells you planned maintenance was happening. It was being *recorded*
 * the way a breakdown is recorded: after the fact, from a sheet, as though
 * somebody had happened to attend. That has three consequences, and they get
 * progressively worse:
 *
 *   1. Planned work that lives only as an intention gets done late, or gets
 *      done when the client rings to ask why nobody came.
 *
 *   2. Nothing knows a client is covered, so a covered client gets quoted for
 *      a call-out — which is the single most reliable way to lose a contract.
 *
 *   3. The business cannot forecast. Call-out revenue is a function of other
 *      people's equipment failing; contract revenue is a function of a
 *      signature, and it is the only line in this module that can be counted
 *      before it happens.
 *
 * An agreement here generates real bookings through the same conflict check
 * everything else uses, so planned work competes for the same technician-hours
 * as breakdowns rather than living in a parallel calendar that nobody honours.
 */

const today = () => new Date().toISOString().slice(0, 10)

const blankContract = (count: number): ServiceContract => {
  const start = new Date()
  const end = new Date()
  end.setFullYear(end.getFullYear() + 1)

  return {
    id: `sc-${Date.now().toString(36)}`,
    reference: `SC-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`,
    client: '',
    address: '',
    clientType: 'Institutional',
    contact: '',
    phone: '',
    email: '',
    equipment: [],
    frequency: 'quarterly',
    coverage: 'pms-only',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    value: 0,
    responseHours: null,
    generatedThrough: null,
    active: true,
    notes: '',
  }
}

/** Annualised value, so a monthly and an annual agreement are comparable. */
const annualValue = (contract: ServiceContract) => contract.value * (12 / frequencyMonths(contract.frequency))

/* -------------------------------------------------------------------------- */

function ContractEditor({
  contract,
  onChange,
}: {
  contract: ServiceContract
  onChange: (next: ServiceContract) => void
}) {
  const set = <K extends keyof ServiceContract>(key: K, value: ServiceContract[K]) =>
    onChange({ ...contract, [key]: value })

  const field = (label: string, hint: string | null, control: React.ReactNode, className?: string) => (
    <label className={cn('block', className)}>
      <span className="block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{label}</span>
      {hint && <span className="mb-1 block text-[11px] text-ink-3">{hint}</span>}
      <span className={hint ? '' : 'mt-1 block'}>{control}</span>
    </label>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3.5 sm:grid-cols-2">
        {field('Reference', null, <Input value={contract.reference} onChange={(e) => set('reference', e.target.value)} />)}
        {field(
          'Client',
          null,
          <Input value={contract.client} onChange={(e) => set('client', e.target.value)} placeholder="Villabake Bread and Pastries" />,
        )}
        {field(
          'Site address',
          'Where the covered equipment lives.',
          <Textarea value={contract.address} onChange={(e) => set('address', e.target.value)} className="min-h-16" />,
          'sm:col-span-2',
        )}
        {field(
          'Account type',
          null,
          <Select value={contract.clientType} onChange={(e) => set('clientType', e.target.value)}>
            {CLIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>,
        )}
        {field('Contact', null, <Input value={contract.contact} onChange={(e) => set('contact', e.target.value)} />)}
        {field('Phone', null, <Input value={contract.phone} onChange={(e) => set('phone', e.target.value)} />)}
        {field('Email', null, <Input type="email" value={contract.email} onChange={(e) => set('email', e.target.value)} />)}
      </div>

      {/* Equipment. Empty means everything on site, which is what most
          agreements actually say and what a tick-list of nothing implies. */}
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Equipment covered</p>
        <p className="mb-1.5 text-[11px] text-ink-3">
          Leave everything unticked to cover any unit at the site — which is what a blanket agreement means.
        </p>
        <div className="max-h-40 overflow-y-auto rounded-xl border border-line p-2">
          <div className="grid gap-0.5 sm:grid-cols-2">
            {EQUIPMENT_TYPES.map((type) => {
              const on = contract.equipment.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    set(
                      'equipment',
                      on ? contract.equipment.filter((e) => e !== type) : [...contract.equipment, type],
                    )
                  }
                  className={cn(
                    'rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
                    on ? 'bg-brand-50 font-medium text-ink dark:bg-brand-950' : 'text-ink-2 hover:bg-surface-2',
                  )}
                >
                  {on ? '✓ ' : ''}
                  {type}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        {field(
          'Visit frequency',
          'How often a planned visit falls due.',
          <Select value={contract.frequency} onChange={(e) => set('frequency', e.target.value as ContractFrequency)}>
            {CONTRACT_FREQUENCIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>,
        )}
        {field(
          'Coverage',
          'What the client does not get billed for.',
          <Select value={contract.coverage} onChange={(e) => set('coverage', e.target.value as CoverageLevel)}>
            {COVERAGE_LEVELS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>,
        )}
        {field('Starts', null, <Input type="date" value={contract.startDate} onChange={(e) => set('startDate', e.target.value)} />)}
        {field('Ends', null, <Input type="date" value={contract.endDate} onChange={(e) => set('endDate', e.target.value)} />)}
        {field(
          'Value per visit',
          'What each planned visit is billed at.',
          <Input
            type="number"
            min={0}
            value={contract.value || ''}
            onChange={(e) => set('value', Number(e.target.value) || 0)}
          />,
        )}
        {field(
          'Response promise',
          'Hours, if this agreement beats the standard priority table. Blank follows the default.',
          <Input
            type="number"
            min={0}
            value={contract.responseHours ?? ''}
            placeholder="Follows the standard SLA"
            onChange={(e) => set('responseHours', e.target.value === '' ? null : Number(e.target.value))}
          />,
        )}
      </div>

      <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-ink-2">
        {COVERAGE_LEVELS.find((c) => c.id === contract.coverage)?.detail} At{' '}
        {money(contract.value, { decimals: false })} a visit,{' '}
        {CONTRACT_FREQUENCIES.find((f) => f.id === contract.frequency)?.label.toLowerCase()}, this is{' '}
        <strong className="text-ink">{money(annualValue(contract), { decimals: false })}</strong> a year.
      </p>

      <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
        <span>
          <span className="block text-[13px] font-medium text-ink">Active</span>
          <span className="block text-[11px] text-ink-3">
            Inactive agreements keep their history but stop covering new calls and stop generating visits.
          </span>
        </span>
        <Switch checked={contract.active} onChange={(next) => set('active', next)} />
      </label>

      {field(
        'Notes',
        'Anything the technician should know before the first planned visit.',
        <Textarea value={contract.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-16" />,
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function ServiceContracts() {
  const toast = useToast()
  const contracts = useSchedule((s) => s.contracts)
  const visits = useSchedule((s) => s.visits)
  const upsertContract = useSchedule((s) => s.upsertContract)
  const removeContract = useSchedule((s) => s.removeContract)
  const generate = useSchedule((s) => s.generateContractVisits)

  const [draft, setDraft] = React.useState<ServiceContract | null>(null)

  const active = contracts.filter((c) => c.active && c.endDate >= today())
  const recurring = active.reduce((s, c) => s + annualValue(c), 0)

  /** Agreements ending inside ninety days — the renewal list. */
  const expiring = React.useMemo(() => {
    const horizon = new Date()
    horizon.setDate(horizon.getDate() + 90)
    const key = dateKey(horizon)
    return active.filter((c) => c.endDate <= key).sort((a, b) => a.endDate.localeCompare(b.endDate))
  }, [active])

  /**
   * Planned visits that have fallen due and were never booked.
   *
   * This is the number an agreement exists to make impossible, and the one a
   * spreadsheet cannot produce: it needs the contract's schedule and the
   * booking history in the same place.
   */
  const overdue = React.useMemo(() => {
    const rows: { contract: ServiceContract; day: string }[] = []
    const start = new Date()
    start.setMonth(start.getMonth() - 12)

    for (const contract of active) {
      for (const day of contractDueDates(contract, start, new Date())) {
        const attended = visits.some(
          (v) =>
            v.contractId === contract.id &&
            v.status !== 'Cancelled' &&
            Math.abs(new Date(v.start).getTime() - new Date(`${day}T00:00:00`).getTime()) < 14 * 86_400_000,
        )
        if (!attended) rows.push({ contract, day })
      }
    }

    return rows.sort((a, b) => b.day.localeCompare(a.day))
  }, [active, visits])

  const runGeneration = (contract: ServiceContract) => {
    const through = new Date()
    through.setMonth(through.getMonth() + 6)
    const result = generate(contract.id, through.toISOString().slice(0, 10))

    if (!result.booked && !result.skipped.length) {
      return toast({ tone: 'info', title: 'Nothing due', description: 'No planned visit falls in the next six months.' })
    }
    toast({
      tone: result.skipped.length ? 'warning' : 'success',
      title: `${num(result.booked)} planned visit${result.booked === 1 ? '' : 's'} booked`,
      description: result.skipped.length
        ? `${num(result.skipped.length)} could not be placed: ${result.skipped[0]!.reason}. Book those by hand from the schedule board.`
        : 'They are on the schedule board and count against technician capacity like any other job.',
    })
  }

  return (
    <div>
      <PageHeader
        title="Service Agreements"
        description="Planned maintenance as a commitment rather than an intention — who is covered, what falls due, and the revenue that arrives whether or not anything breaks."
        meta={
          <>
            <Badge tone="neutral">{num(active.length)} active</Badge>
            {overdue.length > 0 && (
              <Badge tone="critical" dot>
                {num(overdue.length)} planned visit{overdue.length === 1 ? '' : 's'} missed
              </Badge>
            )}
            {expiring.length > 0 && (
              <Badge tone="warning" dot>
                {num(expiring.length)} up for renewal
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  'service-agreements',
                  [
                    { header: 'Reference', value: (c: ServiceContract) => c.reference },
                    { header: 'Client', value: (c: ServiceContract) => c.client },
                    { header: 'Site', value: (c: ServiceContract) => c.address },
                    { header: 'Frequency', value: (c: ServiceContract) => c.frequency },
                    { header: 'Coverage', value: (c: ServiceContract) => c.coverage },
                    { header: 'Starts', value: (c: ServiceContract) => c.startDate },
                    { header: 'Ends', value: (c: ServiceContract) => c.endDate },
                    { header: 'Per visit', value: (c: ServiceContract) => c.value },
                    { header: 'Annualised', value: (c: ServiceContract) => Math.round(annualValue(c)) },
                    { header: 'Active', value: (c: ServiceContract) => (c.active ? 'Yes' : 'No') },
                  ],
                  contracts,
                )
              }
            >
              Export
            </Button>
            <Button variant="primary" size="sm" onClick={() => setDraft(blankContract(contracts.length))}>
              <Plus className="size-3.5" />
              New agreement
            </Button>
          </>
        }
      />

      <StatGrid className="mb-4">
        <StatTile
          label="Recurring revenue"
          value={money(recurring, { decimals: false })}
          icon={Repeat}
          hint="Annualised across every active agreement"
        />
        <StatTile
          label="Sites under cover"
          value={num(new Set(active.map((c) => c.client.trim().toLowerCase())).size)}
          icon={ShieldCheck}
          hint={`${num(active.length)} agreement${active.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Planned visits missed"
          value={num(overdue.length)}
          icon={CalendarClock}
          hint="Fell due in the last year with nobody sent"
        />
        <StatTile
          label="Up for renewal"
          value={num(expiring.length)}
          icon={TrendingUp}
          hint="Ending inside ninety days"
        />
      </StatGrid>

      {/* The missed list first. An agreement whose visits are not happening is
          worse than no agreement: it is a bill the client is paying for
          something they are not getting, and it is found at renewal. */}
      {overdue.length > 0 && (
        <Card className="mb-4 border-critical/40">
          <CardHeader
            title="Planned visits that never happened"
            subtitle="Due under an agreement in the last twelve months with no visit within a fortnight either side."
            action={<Badge tone="critical">{num(overdue.length)}</Badge>}
          />
          <div className="divide-y divide-line border-t border-line">
            {overdue.slice(0, 8).map(({ contract, day }) => (
              <div key={`${contract.id}-${day}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="font-mono text-[12px] text-ink-2">{contract.reference}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{contract.client}</span>
                <span className="shrink-0 text-[11px] text-ink-3">due {fmtDate(`${day}T00:00:00`)}</span>
              </div>
            ))}
            {overdue.length > 8 && (
              <p className="px-5 py-2 text-[11px] text-ink-3">and {num(overdue.length - 8)} more.</p>
            )}
          </div>
        </Card>
      )}

      {contracts.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileCheck}
            title="No agreements yet"
            description="A maintenance agreement turns planned work from something remembered into something booked — and turns call-out revenue into revenue you can forecast."
            action={
              <Button variant="primary" size="sm" onClick={() => setDraft(blankContract(0))}>
                <Plus className="size-3.5" />
                New agreement
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {contracts.map((contract) => {
            const coverage = COVERAGE_LEVELS.find((c) => c.id === contract.coverage)
            const expired = contract.endDate < today()
            const booked = visits.filter((v) => v.contractId === contract.id && v.status !== 'Cancelled').length

            return (
              <Card key={contract.id} className={cn('p-3', (!contract.active || expired) && 'opacity-60')}>
                <button type="button" onClick={() => setDraft(contract)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="font-mono text-[13px] font-semibold text-ink">{contract.reference}</span>
                    {expired ? (
                      <Badge tone="neutral">Expired</Badge>
                    ) : contract.active ? (
                      <Badge tone="good" dot>
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                    <Badge tone="brand">{CONTRACT_FREQUENCIES.find((f) => f.id === contract.frequency)?.label}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{contract.client || 'Unnamed'}</span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {coverage?.label} ·{' '}
                        {contract.equipment.length ? `${contract.equipment.length} unit types` : 'all equipment on site'}
                        {contract.responseHours ? ` · ${contract.responseHours} h response` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-[13px] font-medium text-ink">
                        {money(annualValue(contract), { decimals: false })}
                      </span>
                      <span className="block text-[10px] text-ink-3">a year</span>
                    </span>
                  </div>
                </button>

                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                    <Wallet className="size-3" />
                    {fmtDate(`${contract.startDate}T00:00:00`)} → {fmtDate(`${contract.endDate}T00:00:00`)}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    {num(booked)} visit{booked === 1 ? '' : 's'} booked
                    {contract.generatedThrough && ` · generated through ${fmtDate(`${contract.generatedThrough}T00:00:00`)}`}
                  </span>
                  {contract.active && !expired && (
                    <Button variant="secondary" size="xs" className="ml-auto" onClick={() => runGeneration(contract)}>
                      <CalendarClock className="size-3" />
                      Book the next six months
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        size="2xl"
        dirty
        title={draft ? `Agreement ${draft.reference}` : ''}
        description="What is covered, how often, and what the client is promised in return."
        footer={
          <>
            {draft && contracts.some((c) => c.id === draft.id) && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto"
                onClick={() => {
                  removeContract(draft.id)
                  setDraft(null)
                }}
              >
                Remove
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (!draft) return
                if (!draft.client.trim()) {
                  return toast({ tone: 'error', title: 'The agreement needs a client.' })
                }
                if (draft.endDate <= draft.startDate) {
                  return toast({ tone: 'error', title: 'The end date has to be after the start date.' })
                }
                upsertContract(draft)
                toast({
                  tone: 'success',
                  title: `${draft.reference} saved`,
                  description: 'Calls from this client are now checked against it at booking.',
                })
                setDraft(null)
              }}
            >
              Save agreement
            </Button>
          </>
        }
      >
        {draft && <ContractEditor contract={draft} onChange={setDraft} />}
      </Modal>
    </div>
  )
}

/** Equipment covered anywhere, for the availability page's skill hints. */
export const coveredEquipment = (contracts: ServiceContract[]): EquipmentType[] => [
  ...new Set(contracts.filter((c) => c.active).flatMap((c) => c.equipment)),
]
