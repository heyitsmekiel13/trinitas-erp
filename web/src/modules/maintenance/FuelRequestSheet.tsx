import * as React from 'react'
import { useCompany } from '@/lib/company'
import { fmtDate, fmtDateTime, money, num } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { FuelRequestRecord } from '@/lib/adminApi'
import { FUEL_PRODUCTS, OWNERSHIP_CODES } from './fuelForm'

/**
 * The Fuel Purchase Order Form.
 *
 * The pad this replaces is a well-organised document: one bordered rectangle,
 * a boxed title, aligned colons, two columns, a tick-list down the right. Its
 * structure is kept exactly — every field, in the same order, under the same
 * name — because the people at the other end have read that layout for years.
 *
 * What changed is the execution. The first pass was a dashboard of stat tiles;
 * the second was a faithful but cramped photocopy in 8-point type. This one
 * keeps the paper's bones and sets them properly: a real type scale, a
 * consistent 4-point spacing rhythm, hairline rules in a grey that reads as
 * deliberate rather than faded, and one accent used in three places only —
 * the title band, the selected ownership box, and the ticked products.
 *
 * Only four things appear that the pad has no room for, and each is small:
 * the approver's name written into the "Approved by" field that already
 * exists, the charge sales invoice on the custodian's rule, the status, and a
 * single "Basis" strip along the foot showing the working behind the Quantity.
 */

const hoursMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`

const STATUS_STYLE: Record<string, string> = {
  Draft: 'bg-surface-3 text-ink-2',
  Submitted: 'bg-info/12 text-info',
  Approved: 'bg-good/12 text-good',
  Rejected: 'bg-critical/12 text-critical',
  Issued: 'bg-good/12 text-good',
  Cancelled: 'bg-surface-3 text-ink-3',
}

/* -------------------------------------------------------------------------- */
/* Form furniture                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `Label : value on a rule` — the row the whole form is built from.
 *
 * The label takes a fixed width so the colons line up down each column, which
 * is most of what separates a form that looks set from one that looks typed.
 */
function Row({
  label,
  value,
  labelWidth = '7rem',
  className,
}: {
  label: string
  value?: React.ReactNode
  labelWidth?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-end gap-2', className)}>
      <span
        className="shrink-0 pb-1 text-[10.5px] leading-tight font-medium tracking-wide text-ink-2"
        style={{ width: labelWidth }}
      >
        {label}
      </span>
      <span className="shrink-0 pb-1 text-[10.5px] text-ink-3">:</span>
      <span className="min-w-0 flex-1 truncate border-b border-line-strong pb-1 text-[12.5px] leading-tight font-medium text-ink">
        {value || <span className="text-ink-3">—</span>}
      </span>
    </div>
  )
}

function Tick({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-[11.5px] leading-[1.5]">
      <span
        className={cn(
          'mt-[3px] flex size-[13px] shrink-0 items-center justify-center rounded-[3px] border text-[9px] leading-none font-bold transition-colors',
          on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong bg-surface',
        )}
        aria-hidden
      >
        {on ? '✓' : ''}
      </span>
      <span className={on ? 'font-semibold text-ink' : 'text-ink-2'}>{children}</span>
    </span>
  )
}

/** Name, a rule under the name, then the position. */
function Signature({
  name,
  position,
  stamp,
}: {
  name?: string | null
  position: string
  stamp?: string | null
}) {
  return (
    <div className="max-w-[16rem] min-w-0">
      <p className="truncate pb-1 text-[13px] leading-tight font-semibold text-ink">
        {name || <span className="text-ink-3">&nbsp;</span>}
      </p>
      <div className="border-b border-ink" />
      <p className="mt-1 text-[10px] leading-tight font-medium tracking-wide text-ink-2 uppercase">{position}</p>
      {stamp && <p className="mt-px text-[10px] leading-tight text-ink-3">{stamp}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function FuelRequestSheet({ request }: { request: FuelRequestRecord }) {
  const company = useCompany()

  const quantity = request.approvedLitres ?? request.suggestedLitres
  const trimmed = request.approvedLitres !== null && request.approvedLitres + 0.01 < request.suggestedLitres
  const products = request.products ?? []
  const year = new Date(request.createdAt ?? Date.now()).getFullYear()

  return (
    <div
      className="mx-auto max-w-[50rem] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[var(--shadow-card)]"
      data-print="keep"
    >
      {/* ------------------------------ letterhead ---------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-6 px-6 pt-6 pb-5">
        <div className="flex min-w-0 items-start gap-3.5">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" className="size-12 shrink-0 object-contain" />
          ) : (
            <span className="grad-brand flex size-12 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold text-white">
              {company.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[16px] leading-tight font-bold tracking-tight text-ink uppercase">
              {company.legalName || company.name}
            </p>
            {company.address && (
              <p className="mt-1 max-w-[21rem] text-[10.5px] leading-[1.5] text-ink-3">{company.address}</p>
            )}
            {company.phone && <p className="text-[10.5px] leading-[1.5] text-ink-3">Telephone No. {company.phone}</p>}
          </div>
        </div>

        {/*
            The pad's corner block, set as a document-meta card.

            It leads on the system's own reference now. The hand-written pad
            serial it used to carry has gone: the reference is unique,
            sequential and impossible to mistype, and two identities for one
            document is a reconciliation problem rather than a belt and braces.
        */}
        <div className="w-[11.5rem] shrink-0 rounded-lg bg-surface-2 px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[9.5px] font-medium tracking-wide text-ink-3 uppercase">Order No.</span>
            <span className="font-mono text-[13px] leading-none font-bold text-critical">{request.reference}</span>
          </div>
          <dl className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-[10px] leading-tight text-ink-3">
            {[
              ['Form Code', 'FPOF'],
              ['Form Keeper', 'F&A'],
              ['Series of', String(year)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt>{k}</dt>
                <dd className="font-medium text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
          <span
            className={cn(
              'mt-2.5 block rounded px-2 py-1 text-center text-[10px] font-bold tracking-[0.08em] uppercase',
              STATUS_STYLE[request.status] ?? 'bg-surface-3 text-ink-2',
            )}
          >
            {request.status}
          </span>
        </div>
      </div>

      {/* --------------------------- to / from / unit ------------------------- */}
      <div className="grid gap-x-8 gap-y-3 border-t border-line px-6 py-4 sm:grid-cols-2">
        <Row label="To" value={request.supplier} />
        <Row label="Date Requested" value={request.createdAt ? fmtDate(request.createdAt) : ''} />
        <Row label="From" value={company.legalName || company.name} />
        <Row label="Business Unit" value={request.businessUnit} />
      </div>

      {/* -------------------------------- title ------------------------------- */}
      <div className="grad-brand px-6 py-2.5">
        <h2 className="text-[14px] leading-tight font-bold tracking-[0.1em] text-white uppercase">
          Fuel Purchase Order Form (P.O.)
        </h2>
      </div>

      {/* ------------------------------ ownership ----------------------------- */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-line px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="text-[10.5px] font-medium tracking-wide text-ink-2">Vehicle Ownership</span>
          <span className="flex gap-1">
            {OWNERSHIP_CODES.map((code) => (
              <span
                key={code.value}
                title={code.label}
                className={cn(
                  'rounded border px-2.5 py-1 text-[10.5px] leading-none font-bold transition-colors',
                  request.vehicleOwnership === code.value
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-line-strong text-ink-3',
                )}
              >
                {code.value}
              </span>
            ))}
          </span>
        </span>

        <Row
          label="Purchase Order Category"
          value={request.poCategory}
          labelWidth="10.5rem"
          className="min-w-[15rem] flex-1"
        />
      </div>

      {/* ------------------------------ two columns --------------------------- */}
      <div className="grid sm:grid-cols-2">
        <div className="space-y-3.5 border-line px-6 py-5 sm:border-r">
          <Row label="Plate Number" value={request.vehicle} />
          <Row label="Type / Model" value={request.vehicleModel} />
          <Row label="Driver's Name" value={request.driver} />
          <Row label="Destination" value={request.destinationLabel} />
          <Row label="Purpose" value={request.purpose} />
        </div>

        <div className="space-y-3.5 px-6 py-5">
          {request.vehicleOwnership === 'PO' ? (
            <Row
              label="Reimbursement"
              labelWidth="7rem"
              value={<span className="text-[15px] font-bold">{money(request.mileageAmount ?? 0, { decimals: false })}</span>}
            />
          ) : (
            <>
              <Row
                label="Quantity"
                labelWidth="5rem"
                value={
                  <span className="flex items-baseline gap-2">
                    <span className="text-[15px] font-bold">{num(quantity, 2)}</span>
                    {trimmed && (
                      <span className="text-[10px] font-normal text-ink-3">
                        trimmed from {num(request.suggestedLitres, 2)}
                      </span>
                    )}
                  </span>
                }
              />
              <Row label="Unit" value={request.unit} labelWidth="5rem" />
            </>
          )}

          <div className="flex items-start gap-2">
            <span className="w-[5rem] shrink-0 pt-px text-[10.5px] leading-tight font-medium tracking-wide text-ink-2">
              Products
            </span>
            <span className="shrink-0 text-[10.5px] text-ink-3">:</span>
            <div className="grid min-w-0 flex-1 gap-1.5">
              {FUEL_PRODUCTS.map((product) => (
                <Tick key={product} on={products.includes(product)}>
                  {product}
                </Tick>
              ))}
              <Tick on={Boolean(request.productOther)}>
                <span className="flex items-baseline gap-1.5">
                  Others:
                  <span className="min-w-[5rem] border-b border-line-strong text-[11px]">
                    {request.productOther || <>&nbsp;</>}
                  </span>
                </span>
              </Tick>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------- approvals & custodian ---------------------- */}
      <div className="grid gap-x-8 gap-y-5 border-t border-line px-6 py-5 sm:grid-cols-2">
        <div className="space-y-5">
          <Row
            label="Approved by"
            value={
              request.approvedBy ? (
                <span>
                  {request.approvedBy}
                  {request.approvedByRole && (
                    <span className="ml-1.5 text-[10px] font-normal text-ink-3">{request.approvedByRole}</span>
                  )}
                </span>
              ) : null
            }
          />

          <div className="rounded-lg bg-surface-2 px-3.5 py-3">
            <p className="text-[10px] leading-[1.5] text-ink-3">
              <span className="font-semibold tracking-wide text-ink-2 uppercase">To Custodian</span>
              <br />
              Please indicate the Charge Sales Invoice number below.
            </p>
            <p className="mt-2 max-w-[13rem] border-b border-ink-3 pb-1 text-[12.5px] font-semibold text-ink">
              {request.chargeInvoiceNo || <span className="text-ink-3">&nbsp;</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-5">
          {request.decisionNote && (
            <div>
              <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">Note from the approver</p>
              <p className="mt-1 text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
                {request.decisionNote}
              </p>
            </div>
          )}

          <Signature
            name={company.legalName || company.name}
            position="Operations Manager"
            stamp={request.decidedAt ? fmtDate(request.decidedAt) : null}
          />
        </div>
      </div>

      {/*
          The one addition the pad has no field for.
          A single strip, because it is the working behind the Quantity above
          rather than a section in its own right.
      */}
      <div className="border-t border-line bg-surface-2 px-6 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-[10.5px] leading-tight text-ink-3">
          <span className="font-semibold tracking-wide text-ink-2 uppercase">Basis</span>
          <span className="basis-full text-ink-2">
            {request.legs.length > 1
              ? request.legs
                  .map((leg) => leg.originLabel)
                  .concat(request.legs[request.legs.length - 1]?.destinationLabel ?? '')
                  .join(' → ')
              : `${request.originLabel} → ${request.destinationLabel}`}
          </span>
          {[
            [`${num(request.distanceKm, 1)} km`, request.legs.length > 1 ? `${request.legs.length} legs` : request.roundTrip ? 'return' : 'one way'],
            [hoursMinutes(request.durationMinutes), 'travel'],
            ...(request.departAt ? [[fmtDateTime(request.departAt), 'departs']] : []),
            ...(request.eta ? [[fmtDateTime(request.eta), 'arrives approx.']] : []),
            ...(request.vehicleOwnership === 'PO'
              ? [[money(request.mileageRate ?? 0), 'per km'] as [string, string]]
              : ([
                  [
                    request.kmPerLitre > 0 ? `${num(request.kmPerLitre, 1)} km/L` : 'assumed economy',
                    `+${request.reservePct}% reserve`,
                  ],
                  [money(quantity * request.fuelPrice, { decimals: false }), `at ${money(request.fuelPrice)}/L`],
                ] as [string, string][])),
          ].map(([value, label]) => (
            <span key={`${label}-${value}`}>
              <span className="font-medium text-ink">{value}</span> {label}
            </span>
          ))}
          <span className="basis-full text-ink-3">
            Measured by{' '}
            {request.routeSource === 'google'
              ? 'Google Directions'
              : request.routeSource === 'osrm'
                ? 'OpenStreetMap routing'
                : 'direct-line estimate — not a road route'}
            {request.notes && <> · {request.notes}</>}
          </span>
        </div>
      </div>
    </div>
  )
}
