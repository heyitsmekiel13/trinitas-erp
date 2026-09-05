import * as React from 'react'
import { Check, ClipboardList, Clock, PenLine, Printer, Trash2, Wrench } from 'lucide-react'
import { cn } from '@/lib/cn'
import { currentUser } from '@/app/auth'
import { useCompany } from '@/lib/company'
import { fromLocalInput, money, num, toLocalInput } from '@/lib/format'
import { printRegion } from '@/lib/export'
import {
  CLIENT_TYPES,
  COST_TYPES,
  EQUIPMENT_TYPES,
  JUSTIFICATION_CODES,
  PART_SOURCES,
  PURCHASED_BY,
  REPAIR_STATUSES,
  REPAIR_TYPES,
  STANDARD_RECOMMENDATIONS,
  WARRANTY_STATES,
  fmtDuration,
  minutesOnSite,
  sumMoney,
  type ClientType,
  type CostType,
  type EquipmentType,
  type JustificationCode,
  type PartSource,
  type RepairStatus,
  type RepairType,
  type ServiceReport,
  type WarrantyState,
} from '@/data/afterSales'
import {
  ACTION_CODES,
  CAUSE_CODES,
  SYMPTOM_CODES,
  VISIT_OUTCOMES,
  blankPart,
  costJob,
  type PartLine,
} from '@/data/serviceQuality'
import { Badge, Button, Card, Input, Select, Textarea } from '@/components/ui/primitives'

/**
 * The Technician Service Report, as a form rather than a carbon-copy pad.
 *
 * Every field of the printed TSR is here, in the order the paper has it, so a
 * technician who has filled the pad for years does not have to relearn
 * anything. Three things the paper could not do:
 *
 *   - The time on site is computed from the two stamps rather than worked out
 *     in the van and written in the Total box.
 *   - The money is captured on the report itself. On paper the charge is
 *     re-keyed into the revenue workbook days later from a photo of the form,
 *     which is exactly where the workbook's blank revenue rows come from.
 *   - It prints. The layout below is the printed output too, so a client still
 *     gets a document to sign.
 */

const BLANK: ServiceReport = {
  id: '',
  series: '',
  ticket: '',
  client: '',
  clientAddress: '',
  clientType: 'Institutional',
  reportDate: new Date().toISOString().slice(0, 10),
  timeIn: null,
  timeOut: null,
  equipment: [],
  findings: '',
  scopeOfWork: '',
  model: '',
  serialNo: '',
  partSources: [],
  purchaseDate: null,
  warranty: null,
  purchasedBy: null,
  recommendation: '',
  standardRecommendations: [],
  status: [],
  leadTechnician: '',
  assistantTechnician: '',
  witnessedBy: '',
  witnessDesignation: '',
  justification: '',
  justificationCode: null,
  revenue: {},
  costs: {},
  symptom: '',
  cause: '',
  action: '',
  outcome: '',
  parts: [],
  labourHours: 0,
}

/** A tick box that reads as one on paper and as a control on screen. */
function Tick({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
        checked ? 'bg-brand-50 text-ink dark:bg-brand-950' : 'text-ink-2 hover:bg-surface-2',
        className,
      )}
    >
      <span
        className={cn(
          'mt-px flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
          checked ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong bg-surface',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

function Block({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-line', className)} data-print="keep">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-ink-2 uppercase">{title}</h3>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold tracking-wider text-ink-3 uppercase">{label}</span>
      {children}
    </label>
  )
}

export function ServiceReportForm({
  report,
  onChange,
  onSave,
  readOnly,
}: {
  report: ServiceReport
  onChange: (next: ServiceReport) => void
  onSave?: () => void
  readOnly?: boolean
}) {
  const company = useCompany()
  const sheetRef = React.useRef<HTMLDivElement>(null)

  const set = <K extends keyof ServiceReport>(key: K, value: ServiceReport[K]) =>
    onChange({ ...report, [key]: value })

  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  const onSite = minutesOnSite(report)
  const revenueTotal = sumMoney(report.revenue)
  const costTotal = sumMoney(report.costs)

  const parts: PartLine[] = report.parts ?? []
  const cause = CAUSE_CODES.find((c) => c.code === report.cause) ?? null
  const costing = costJob({
    serviceRevenue: revenueTotal,
    recoveredCosts: costTotal,
    parts,
    labourHours: report.labourHours ?? 0,
  })

  const setPart = (index: number, next: PartLine) =>
    set(
      'parts',
      parts.map((p, i) => (i === index ? next : p)),
    )

  return (
    <div ref={sheetRef} className="space-y-4">
      {/* ------------------------------- Letterhead ------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div className="flex items-center gap-3">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" className="size-12 rounded object-contain" />
          ) : (
            <span className="grad-brand flex size-12 items-center justify-center rounded text-lg font-bold text-white">
              {company.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-bold tracking-tight text-ink uppercase">{company.name}</p>
            <p className="text-[11px] font-semibold text-ink-2 uppercase">Engineering Department</p>
            <p className="max-w-md text-[10px] text-ink-3">{company.address}</p>
          </div>
        </div>
        <div className="text-right text-[10px] text-ink-3">
          <p className="font-semibold">Form Code | ED/M - TSR</p>
          <p>Form Keeper — Operations</p>
          <p>Series of {new Date(report.reportDate || Date.now()).getFullYear()} (v2)</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[19px] font-bold tracking-tight text-ink">TECHNICIAN SERVICE REPORT (TSR)</h2>
        <div className="flex items-center gap-2" data-print="hide">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              printRegion(sheetRef.current, {
                title: `Technician Service Report ${report.series || ''}`.trim(),
                subtitle: `${report.client || 'Client'} · ${report.ticket || 'no ticket'}`,
                preparedBy: currentUser().name,
              })
            }
          >
            <Printer className="size-3.5" />
            Print
          </Button>
          {onSave && !readOnly && (
            <Button variant="primary" size="sm" onClick={onSave}>
              <Check className="size-3.5" />
              Save report
            </Button>
          )}
        </div>
      </div>

      {/* --------------------------------- Header -------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Line label="TSR series #">
          <Input
            value={report.series}
            disabled={readOnly}
            onChange={(e) => set('series', e.target.value)}
            placeholder="5451"
            className="font-mono font-semibold"
          />
        </Line>
        <Line label="Repair ticket #">
          <Input value={report.ticket} disabled={readOnly} onChange={(e) => set('ticket', e.target.value)} />
        </Line>
        <Line label="Report date">
          <Input
            type="date"
            value={report.reportDate}
            disabled={readOnly}
            onChange={(e) => set('reportDate', e.target.value)}
          />
        </Line>
        <Line label="Client classification">
          <Select
            value={report.clientType}
            disabled={readOnly}
            onChange={(e) => set('clientType', e.target.value as ClientType)}
          >
            {CLIENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Line>

        <Line label="Client / customer name">
          <Input value={report.client} disabled={readOnly} onChange={(e) => set('client', e.target.value)} />
        </Line>
        <Line label="Client address">
          <Input
            value={report.clientAddress}
            disabled={readOnly}
            onChange={(e) => set('clientAddress', e.target.value)}
          />
        </Line>
        <Line label="Time in">
          <Input
            type="datetime-local"
            value={toLocalInput(report.timeIn)}
            disabled={readOnly}
            onChange={(e) => set('timeIn', fromLocalInput(e.target.value))}
          />
        </Line>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Line label="Time out">
            <Input
              type="datetime-local"
              value={toLocalInput(report.timeOut)}
              disabled={readOnly}
              onChange={(e) => set('timeOut', fromLocalInput(e.target.value))}
            />
          </Line>
          {/* Computed, never typed — the paper form's Total box was arithmetic
              done in a van at the end of a long day. */}
          <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-center">
            <p className="text-[9px] tracking-wider text-ink-3 uppercase">Total</p>
            <p className="tabular flex items-center gap-1 text-[13px] font-semibold text-ink">
              <Clock className="size-3 text-ink-3" />
              {fmtDuration(onSite)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* ------------------------------ Equipment ------------------------------ */}
        <Block title="Equipment type & description">
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {EQUIPMENT_TYPES.map((type) => {
              const entry = report.equipment.find((e) => e.type === type)
              return (
                <div key={type}>
                  <Tick
                    checked={Boolean(entry)}
                    onChange={(on) =>
                      set(
                        'equipment',
                        on
                          ? [...report.equipment, { type: type as EquipmentType, description: '' }]
                          : report.equipment.filter((e) => e.type !== type),
                      )
                    }
                  >
                    {type}
                  </Tick>
                  {entry && (
                    <Input
                      value={entry.description}
                      disabled={readOnly}
                      placeholder="Make, size, location…"
                      onChange={(e) =>
                        set(
                          'equipment',
                          report.equipment.map((x) =>
                            x.type === type ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                      className="mt-1 mb-1.5 ml-6 h-7 w-[calc(100%-1.5rem)] text-[12px]"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </Block>

        <div className="space-y-3">
          <Block title="Findings / problem reported">
            <Textarea
              value={report.findings}
              disabled={readOnly}
              onChange={(e) => set('findings', e.target.value)}
              placeholder="What the client reported, and what the technician actually found."
              className="min-h-24 text-[13px]"
            />
          </Block>

          <Block title="Scope of work">
            <Textarea
              value={report.scopeOfWork}
              disabled={readOnly}
              onChange={(e) => set('scopeOfWork', e.target.value)}
              placeholder="What was done, in the order it was done."
              className="min-h-28 text-[13px]"
            />
          </Block>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* ------------------------- Parts & warranty --------------------------- */}
        <Block title="Equipment / parts specification">
          <div className="space-y-2">
            <Line label="Model">
              <Input value={report.model} disabled={readOnly} onChange={(e) => set('model', e.target.value)} className="h-8 text-[13px]" />
            </Line>
            <Line label="Serial no.">
              <Input
                value={report.serialNo}
                disabled={readOnly}
                onChange={(e) => set('serialNo', e.target.value)}
                className="h-8 font-mono text-[13px]"
              />
            </Line>
            <div className="space-y-0.5 pt-1">
              {PART_SOURCES.map((source) => (
                <Tick
                  key={source}
                  checked={report.partSources.includes(source)}
                  onChange={() => set('partSources', toggle(report.partSources, source as PartSource))}
                >
                  {source}
                </Tick>
              ))}
            </div>
          </div>
        </Block>

        <Block title="Warranty coverage & parts">
          <div className="space-y-2">
            <Line label="Date of purchase">
              <Input
                type="date"
                value={report.purchaseDate ?? ''}
                disabled={readOnly}
                onChange={(e) => set('purchaseDate', e.target.value || null)}
                className="h-8 text-[13px]"
              />
            </Line>
            <div className="space-y-0.5">
              {WARRANTY_STATES.map((state) => (
                <Tick
                  key={state}
                  checked={report.warranty === state}
                  onChange={(on) => set('warranty', on ? (state as WarrantyState) : null)}
                >
                  {state}
                </Tick>
              ))}
            </div>
            <p className="pt-1 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Purchased by</p>
            <div className="space-y-0.5">
              {PURCHASED_BY.map((who) => (
                <Tick
                  key={who}
                  checked={report.purchasedBy === who}
                  onChange={(on) => set('purchasedBy', on ? who : null)}
                >
                  {who === 'PKE' ? 'Purchased by PKE' : 'Purchased by client'}
                </Tick>
              ))}
            </div>
          </div>
        </Block>

        <Block title="Status of repair">
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {REPAIR_STATUSES.map((status) => (
              <Tick
                key={status}
                checked={report.status.includes(status)}
                onChange={() => set('status', toggle(report.status, status as RepairStatus))}
              >
                {status}
              </Tick>
            ))}
          </div>
        </Block>
      </div>

      {/* ----------------------------- Recommendation --------------------------- */}
      <Block title="Recommendation">
        <Textarea
          value={report.recommendation}
          disabled={readOnly}
          onChange={(e) => set('recommendation', e.target.value)}
          placeholder="Anything specific to this unit."
          className="mb-3 min-h-16 text-[13px]"
        />
        <div className="grid gap-0.5 sm:grid-cols-2">
          {STANDARD_RECOMMENDATIONS.map((item) => (
            <Tick
              key={item}
              checked={report.standardRecommendations.includes(item)}
              onChange={() => set('standardRecommendations', toggle(report.standardRecommendations, item))}
            >
              {item}
            </Tick>
          ))}
        </div>
      </Block>

      {/* ----------------------- Coded outcome and root cause ------------------- */}
      {/*
          Three dropdowns and one outcome. Everything above this point is prose
          the client signs; this is the same job made countable. Without it the
          business can read its own history one sheet at a time and can never
          count it — which is why "what keeps breaking" has never had an answer.
      */}
      <Block
        title="Fault classification"
        action={
          report.outcome ? (
            <Badge tone={(VISIT_OUTCOMES.find((o) => o.code === report.outcome)?.tone ?? 'neutral') as 'good'}>
              {report.outcome}
            </Badge>
          ) : (
            <span className="text-[11px] text-warning">Not classified — this job stays out of the analysis</span>
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Line label="Symptom — what the client reported">
            <Select
              value={report.symptom}
              disabled={readOnly}
              onChange={(e) => set('symptom', e.target.value)}
              className="h-9 text-[13px]"
            >
              <option value="">Choose…</option>
              {SYMPTOM_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Line>

          <Line label="Cause — what you actually found">
            <Select
              value={report.cause}
              disabled={readOnly}
              onChange={(e) => set('cause', e.target.value)}
              className="h-9 text-[13px]"
            >
              <option value="">Choose…</option>
              {CAUSE_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </Select>
          </Line>

          <Line label="Action — what you did about it">
            <Select
              value={report.action}
              disabled={readOnly}
              onChange={(e) => set('action', e.target.value)}
              className="h-9 text-[13px]"
            >
              <option value="">Choose…</option>
              {ACTION_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Line>
        </div>

        {cause && (
          <p className="mt-2 text-[11px] text-ink-3">
            <span className="font-medium text-ink-2">{cause.category}.</span> {cause.note}
          </p>
        )}

        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">
            Did this visit finish the job?
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {VISIT_OUTCOMES.map((outcome) => (
              <Tick
                key={outcome.code}
                checked={report.outcome === outcome.code}
                onChange={() => set('outcome', report.outcome === outcome.code ? '' : outcome.code)}
              >
                {outcome.code}
                {outcome.firstTimeFix && (
                  <span className="ml-1.5 text-[10px] text-good">counts as a first-time fix</span>
                )}
              </Tick>
            ))}
          </div>
        </div>
      </Block>

      {/* ------------------------------ Parts & labour -------------------------- */}
      {/*
          The margin block. Revenue and reimbursables were already captured; the
          two things that make them mean something — what the parts cost us and
          how many technician-hours went in — were not, so every job looked
          profitable and the long ones looked best of all.
      */}
      <Block
        title="Parts fitted & labour"
        action={
          <span className="text-[11px] text-ink-2">
            Margin{' '}
            <strong className={cn(costing.margin >= 0 ? 'text-good' : 'text-critical')}>
              {money(costing.margin, { decimals: false })}
            </strong>
            {costing.marginPct !== null && <span className="text-ink-3"> · {costing.marginPct.toFixed(0)}%</span>}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10px] tracking-wider text-ink-3 uppercase">
                <th className="py-1.5 pr-2 text-left">SKU</th>
                <th className="py-1.5 pr-2 text-left">Description</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">Our cost</th>
                <th className="py-1.5 pr-2 text-right">Charged</th>
                <th className="py-1.5 pr-2 text-center">Warranty</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {parts.map((part, i) => (
                <tr key={part.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1 pr-2">
                    <Input
                      value={part.sku}
                      disabled={readOnly}
                      placeholder="SKU"
                      onChange={(e) => setPart(i, { ...part, sku: e.target.value.toUpperCase() })}
                      className="h-8 w-24 text-[12px]"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      value={part.description}
                      disabled={readOnly}
                      placeholder="Heating element, 2.4 kW"
                      onChange={(e) => setPart(i, { ...part, description: e.target.value })}
                      className="h-8 text-[12px]"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0}
                      disabled={readOnly}
                      value={part.quantity}
                      onChange={(e) => setPart(i, { ...part, quantity: Number(e.target.value) || 0 })}
                      className="h-8 w-16 text-right text-[12px]"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0}
                      disabled={readOnly}
                      value={part.cost || ''}
                      placeholder="0"
                      onChange={(e) => setPart(i, { ...part, cost: Number(e.target.value) || 0 })}
                      className="h-8 w-24 text-right text-[12px]"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      type="number"
                      min={0}
                      disabled={readOnly || part.underWarranty}
                      value={part.underWarranty ? 0 : part.price || ''}
                      placeholder="0"
                      onChange={(e) => setPart(i, { ...part, price: Number(e.target.value) || 0 })}
                      className="h-8 w-24 text-right text-[12px]"
                    />
                  </td>
                  <td className="py-1 pr-2 text-center">
                    <input
                      type="checkbox"
                      checked={part.underWarranty}
                      disabled={readOnly}
                      onChange={(e) => setPart(i, { ...part, underWarranty: e.target.checked })}
                      aria-label="Supplied under warranty"
                    />
                  </td>
                  <td className="py-1">
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove this part"
                        onClick={() =>
                          set(
                            'parts',
                            parts.filter((p) => p.id !== part.id),
                          )
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {parts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-[11px] text-ink-3">
                    No parts fitted. Add one if anything was replaced — a job that gives away a compressor is a loss the
                    charge column cannot see.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <Button variant="secondary" size="xs" className="mt-2" onClick={() => set('parts', [...parts, blankPart()])}>
            Add a part
          </Button>
        )}

        <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
          <Line label="Technician-hours (count both people)">
            <Input
              type="number"
              min={0}
              step={0.5}
              disabled={readOnly}
              value={report.labourHours || ''}
              placeholder={onSite ? (onSite / 60).toFixed(1) : '0'}
              onChange={(e) => set('labourHours', Number(e.target.value) || 0)}
              className="h-9 text-[13px]"
            />
          </Line>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 self-end text-[11px] sm:col-span-2 sm:grid-cols-4">
            {[
              ['Parts charged', money(costing.revenueParts, { decimals: false })],
              ['Parts cost', money(costing.costParts, { decimals: false })],
              ['Labour cost', money(costing.costLabour, { decimals: false })],
              ['Total billed', money(costing.billed, { decimals: false })],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="block text-[10px] tracking-wide text-ink-3 uppercase">{label}</span>
                <span className="tabular text-[13px] font-medium text-ink">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </Block>

      {/* --------------------------------- Money -------------------------------- */}
      <Block
        title="Charges"
        action={
          <span className="text-[11px] text-ink-2">
            Service <strong className="text-ink">{money(revenueTotal, { decimals: false })}</strong> + recoverable{' '}
            <strong className="text-ink">{money(costTotal, { decimals: false })}</strong> ={' '}
            <strong className="text-ink">{money(revenueTotal + costTotal, { decimals: false })}</strong>
          </span>
        }
      >
        <p className="mb-3 text-[11px] text-ink-3">
          Captured here rather than re-keyed into the revenue workbook from a photograph of this form later — which is
          where the workbook's blank revenue rows come from.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Service charged</p>
            <div className="space-y-1.5">
              {REPAIR_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-[12px] text-ink-2">{type}</span>
                  <Input
                    type="number"
                    min={0}
                    disabled={readOnly}
                    value={report.revenue[type as RepairType] ?? ''}
                    placeholder="0"
                    onChange={(e) =>
                      set('revenue', { ...report.revenue, [type]: Number(e.target.value) || 0 })
                    }
                    className="h-8 w-28 text-right text-[13px]"
                  />
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">
              Recoverable expenses
            </p>
            <div className="space-y-1.5">
              {COST_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-[12px] text-ink-2">{type}</span>
                  <Input
                    type="number"
                    min={0}
                    disabled={readOnly}
                    value={report.costs[type as CostType] ?? ''}
                    placeholder="0"
                    onChange={(e) => set('costs', { ...report.costs, [type]: Number(e.target.value) || 0 })}
                    className="h-8 w-28 text-right text-[13px]"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </Block>

      {/* ------------------------------ Signatures ------------------------------ */}
      <div className="rounded-xl border border-line p-3" data-print="keep">
        <p className="mb-3 text-[10px] leading-relaxed text-ink-3">
          This confirms receipt of the Technician Service Report (TSR) for the services described above. We have
          reviewed the report and acknowledge the key points as specified. As service technicians, we will proceed with
          the necessary steps, including but not limited to billing of appropriate charges. Thank you for trusting{' '}
          {company.name} — Engineering Department.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Line label="Lead technician">
            <Input
              value={report.leadTechnician}
              disabled={readOnly}
              onChange={(e) => set('leadTechnician', e.target.value)}
              className="h-8 text-[13px]"
            />
          </Line>
          <Line label="Asst. technician">
            <Input
              value={report.assistantTechnician}
              disabled={readOnly}
              onChange={(e) => set('assistantTechnician', e.target.value)}
              className="h-8 text-[13px]"
            />
          </Line>
          <Line label="Checked / witnessed by">
            <Input
              value={report.witnessedBy}
              disabled={readOnly}
              onChange={(e) => set('witnessedBy', e.target.value)}
              className="h-8 text-[13px]"
            />
          </Line>
          <Line label="Designation">
            <Input
              value={report.witnessDesignation}
              disabled={readOnly}
              onChange={(e) => set('witnessDesignation', e.target.value)}
              className="h-8 text-[13px]"
            />
          </Line>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Line label="Justification (Operations Dept.)">
            <Textarea
              value={report.justification}
              disabled={readOnly}
              onChange={(e) => set('justification', e.target.value)}
              className="min-h-14 text-[13px]"
            />
          </Line>
          <div>
            <span className="mb-1 block text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Charge to</span>
            <div className="flex flex-wrap gap-1">
              {JUSTIFICATION_CODES.map((code) => (
                <Tick
                  key={code}
                  checked={report.justificationCode === code}
                  onChange={(on) => set('justificationCode', on ? (code as JustificationCode) : null)}
                >
                  {code}
                </Tick>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A fresh report, numbered on from the last pad entry. */
export function blankReport(lastSeries?: string): ServiceReport {
  const next = Number(String(lastSeries ?? '').replace(/\D/g, '')) || 5450
  return {
    ...BLANK,
    id: `tsr-${Date.now()}`,
    series: String(next + 1),
    leadTechnician: currentUser().name,
  }
}

/** Compact summary used by the report list. */
export function ReportSummary({ report }: { report: ServiceReport }) {
  const total = sumMoney(report.revenue) + sumMoney(report.costs)
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <ClipboardList className="size-4 text-brand-500" />
          <span className="font-mono text-[13px] font-semibold text-ink">TSR {report.series}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink">{report.client || 'Unnamed client'}</span>
          <span className="block truncate text-[11px] text-ink-3">
            {report.equipment.map((e) => e.type).join(', ') || 'No equipment ticked'}
          </span>
        </span>
        {report.status.slice(0, 2).map((s) => (
          <Badge key={s} tone="info">
            {s}
          </Badge>
        ))}
        <span className="tabular text-[13px] font-medium text-ink">{money(total, { decimals: false })}</span>
        <span className="flex items-center gap-1 text-[11px] text-ink-3">
          <Wrench className="size-3" />
          {report.leadTechnician || 'unassigned'}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-ink-3">
          <PenLine className="size-3" />
          {num(report.standardRecommendations.length)} rec
        </span>
      </div>
    </Card>
  )
}
