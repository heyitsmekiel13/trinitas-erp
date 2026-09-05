import * as React from 'react'
import QRCode from 'qrcode'
import { Files, IdCard as IdCardIcon, Printer, RotateCw, Search, Upload } from 'lucide-react'
import * as api from '@/lib/adminApi'
import { liveApi } from '@/lib/adminApi'
import { useCompany, type CompanyProfile } from '@/lib/company'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Segmented } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'

/**
 * The printable company badge, and the QR code on it.
 *
 * The QR points at `/id/{token}` on this same app — a public route with no
 * sign-in (see `PublicIdCheck`) that answers the one question a badge exists
 * to answer: is this really who they say they are, and do they still work
 * here. `Employee.public_id_token` is the credential, generated once and
 * good for as long as the card is — see EmployeeIdCardController for why
 * that is a deliberately different choice from the signed URLs used
 * elsewhere for things meant to expire.
 *
 * Active/Inactive is deliberately not printed anywhere on the card itself —
 * a badge is a physical object that outlives the moment it was printed, so
 * a status frozen in ink would just go stale. The QR is the status check;
 * the card only ever claims what stays true for as long as it's carried.
 */

const RED_LINE = 'linear-gradient(90deg, #7a0d1a 0%, #e11d2e 35%, #ff4d5e 60%, #e11d2e 85%, #7a0d1a 100%)'

const CARD_CSS = `
  @media print {
    @page { size: 85.6mm 54mm; margin: 0; }
    body * { visibility: hidden !important; }
    #id-card-print, #id-card-print * { visibility: visible !important; }
    #id-card-print {
      position: fixed; top: 0; left: 0; margin: 0;
    }
    .id-card-page {
      width: 85.6mm; height: 54mm; page-break-after: always;
      box-shadow: none !important; border-radius: 0 !important; border: none !important;
    }
    .id-card-page:last-child { page-break-after: auto; }
  }
`

function EmployeePicker({
  employees,
  onPick,
}: {
  employees: api.EmployeeBasic[]
  onPick: (id: number) => void
}) {
  const [q, setQ] = React.useState('')

  const matches = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return employees.slice(0, 20)
    return employees
      .filter((e) => e.fullName.toLowerCase().includes(term) || e.employeeNo.toLowerCase().includes(term))
      .slice(0, 20)
  }, [employees, q])

  return (
    <Card>
      <div className="p-4 sm:p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or employee number…"
            className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9 text-[13px] text-ink"
          />
        </div>
      </div>
      <div className="max-h-96 divide-y divide-line overflow-y-auto border-t border-line">
        {matches.length === 0 && <p className="p-4 text-[13px] text-ink-3">No employees match that search.</p>}
        {matches.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onPick(e.id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2"
          >
            <span>
              <span className="block text-[13px] font-medium text-ink">{e.fullName}</span>
              <span className="block text-[11px] text-ink-3">{e.employeeNo}</span>
            </span>
            <span className="text-[11px] text-ink-3">{e.department ?? '—'}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

/** A hairline red gradient rule — the one accent borrowed from the sample signature. */
function RedRule({ className = '' }: { className?: string }) {
  return <div className={`h-[2.5px] w-full shrink-0 ${className}`} style={{ backgroundImage: RED_LINE }} />
}

function CardFront({ card, qrDataUrl, logoUrl }: { card: api.IdCard; qrDataUrl: string | null; logoUrl?: string }) {
  return (
    <div
      className="id-card-page relative flex w-[340px] flex-col overflow-hidden rounded-2xl border border-line bg-white text-black shadow-[var(--shadow-pop)]"
      style={{ aspectRatio: '85.6 / 54' }}
    >
      {/* Header — unchanged from the original design. */}
      <div className="grad-brand flex items-center gap-2 px-3.5 py-2">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-6 rounded-md bg-white/90 object-contain p-0.5" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-md bg-white/90 text-[11px] font-bold text-brand-600">T</span>
        )}
        <span className="truncate text-[11px] font-bold tracking-wide text-white uppercase">Trinitas Food Corp</span>
      </div>

      <RedRule />

      <div className="flex flex-1 items-center gap-3 bg-[linear-gradient(180deg,#ffffff_0%,#fff5f6_100%)] px-3.5 py-3">
        <div className="size-[68px] shrink-0 overflow-hidden rounded-lg border-2 border-critical/15 bg-black/5">
          {card.photoUrl ? (
            <img src={card.photoUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[9px] text-black/40">No photo</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold tracking-tight text-black uppercase">{card.name}</p>
          {/* Job titles run long ("TRAINING AND DEVELOPMENT COMPLIANCE
              MANAGER") — truncating one to a single ellipsised line means the
              badge shows a title nobody can actually read. Two lines at a
              slightly smaller size fits every real title on file without
              cutting any of them off. */}
          <p className="line-clamp-2 text-[9px] leading-[1.2] font-semibold text-critical uppercase">
            {card.position ?? '—'}
          </p>
          <p className="truncate text-[10.5px] text-black/60">{card.department ?? '—'}</p>
          <p className="mt-1 font-mono text-[10px] tracking-wide text-black/50">{card.employeeNo}</p>
        </div>

        {qrDataUrl && <img src={qrDataUrl} alt="Verification QR code" className="size-[54px] shrink-0" />}
      </div>

      <RedRule />
      <div className="flex items-center justify-center bg-black/[0.03] px-3.5 py-1.5">
        <span className="text-[8.5px] font-medium tracking-wide text-black/45 uppercase">Scan QR to verify employment</span>
      </div>
    </div>
  )
}

function CardBack({ card, qrDataUrl, company }: { card: api.IdCard; qrDataUrl: string | null; company: CompanyProfile }) {
  return (
    <div
      className="id-card-page relative flex w-[340px] flex-col overflow-hidden rounded-2xl border border-line bg-white text-black shadow-[var(--shadow-pop)]"
      style={{ aspectRatio: '85.6 / 54' }}
    >
      <RedRule />
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        <div className="flex flex-1 flex-col justify-center gap-1">
          <p className="text-[9.5px] leading-snug font-semibold text-black/70 uppercase">
            Property of {company.legalName || company.name}
          </p>
          <p className="text-[8.5px] leading-snug text-black/55">
            If found, please return to:
            <br />
            {company.address || '—'}
          </p>
          {company.phone && <p className="text-[8.5px] text-black/55">Tel: {company.phone}</p>}
          <p className="mt-1.5 font-mono text-[9px] tracking-wide text-black/45">{card.employeeNo}</p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          {qrDataUrl && <img src={qrDataUrl} alt="Verification QR code" className="size-[72px]" />}
          <span className="text-center text-[7.5px] leading-tight font-medium text-black/45 uppercase">Scan to verify</span>
        </div>
      </div>
      <RedRule />
    </div>
  )
}

function BadgePreview({
  card,
  qrDataUrl,
  logoUrl,
  company,
  side,
}: {
  card: api.IdCard
  qrDataUrl: string | null
  logoUrl?: string
  company: CompanyProfile
  side: 'front' | 'back'
}) {
  return (
    <div className="mx-auto">
      {side === 'front' ? (
        <CardFront card={card} qrDataUrl={qrDataUrl} logoUrl={logoUrl} />
      ) : (
        <CardBack card={card} qrDataUrl={qrDataUrl} company={company} />
      )}
    </div>
  )
}

/** Off-screen — exists only so `window.print()` has both sides of every badge to paginate through. */
function PrintStage({
  cards,
  logoUrl,
  company,
}: {
  cards: { card: api.IdCard; qrDataUrl: string | null }[]
  logoUrl?: string
  company: CompanyProfile
}) {
  return (
    <div id="id-card-print" className="hidden print:block">
      {cards.map(({ card, qrDataUrl }) => (
        <React.Fragment key={card.id}>
          <CardFront card={card} qrDataUrl={qrDataUrl} logoUrl={logoUrl} />
          <CardBack card={card} qrDataUrl={qrDataUrl} company={company} />
        </React.Fragment>
      ))}
    </div>
  )
}

async function buildQr(token: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(`${window.location.origin}/id/${token}`, { margin: 1, width: 240 })
  } catch {
    return null
  }
}

export function IdCards() {
  const toast = useToast()
  const company = useCompany()
  const [employees, setEmployees] = React.useState<api.EmployeeBasic[] | null>(null)
  const [card, setCard] = React.useState<api.IdCard | null>(null)
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [side, setSide] = React.useState<'front' | 'back'>('front')
  const [busy, setBusy] = React.useState(false)
  const [printingAll, setPrintingAll] = React.useState(false)
  const [printQueue, setPrintQueue] = React.useState<{ card: api.IdCard; qrDataUrl: string | null }[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!liveApi()) return
    api.listEmployeesBasic().then(setEmployees).catch(() => setEmployees([]))
  }, [])

  const openEmployee = React.useCallback(
    (id: number) => {
      setSide('front')
      api.getIdCard(id).then(setCard).catch((e: Error) => toast({ tone: 'error', title: 'Could not load that employee', description: e.message }))
    },
    [toast],
  )

  React.useEffect(() => {
    if (!card) {
      setQrDataUrl(null)
      return
    }
    buildQr(card.publicToken).then(setQrDataUrl)
  }, [card])

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !card) return
    setBusy(true)
    try {
      const updated = await api.uploadIdPhoto(card.id, file)
      setCard(updated)
      toast({ tone: 'success', title: 'Photo updated' })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not upload that photo', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    if (!card) return
    if (!window.confirm('This invalidates every badge already printed for this person — the QR code on them will stop working. Continue?')) return
    setBusy(true)
    try {
      const updated = await api.regenerateIdToken(card.id)
      setCard(updated)
      toast({ tone: 'success', title: 'New QR code issued', description: 'Reprint the badge — the old one no longer verifies.' })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not reissue the QR code', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const printOne = () => {
    if (!card) return
    setPrintQueue([{ card, qrDataUrl }])
    // Let the print stage actually mount before the dialog opens.
    requestAnimationFrame(() => window.print())
  }

  const printAll = async () => {
    if (!employees?.length) return
    setPrintingAll(true)
    try {
      const cards = await Promise.all(employees.map((e) => api.getIdCard(e.id)))
      const withQr = await Promise.all(cards.map(async (c) => ({ card: c, qrDataUrl: await buildQr(c.publicToken) })))
      setPrintQueue(withQr)
      requestAnimationFrame(() => window.print())
    } catch (error) {
      toast({ tone: 'error', title: 'Could not prepare all badges', description: (error as Error).message })
    } finally {
      setPrintingAll(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="ID Cards"
        description="A printable badge with a QR code anyone can scan to confirm the person still works here, without calling HR."
        meta={
          <Button variant="secondary" size="sm" loading={printingAll} disabled={!employees?.length} onClick={printAll}>
            <Files className="size-3.5" />
            Print all badges
          </Button>
        }
      />

      {!liveApi() ? (
        <Card className="p-5 text-[13px] text-ink-3">Connect the live API (VITE_API_URL) to generate ID cards.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <EmployeePicker employees={employees ?? []} onPick={openEmployee} />

          <div>
            {!card ? (
              <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center text-ink-3">
                <IdCardIcon className="size-8" />
                <p className="text-[13px]">Pick an employee to preview their badge.</p>
              </Card>
            ) : (
              <Card className="p-5 sm:p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{card.name}</p>
                    <p className="text-[11px] text-ink-3">{card.employeeNo}</p>
                  </div>
                  <Segmented
                    value={side}
                    onChange={(v) => setSide(v as 'front' | 'back')}
                    options={[
                      { value: 'front', label: 'Front' },
                      { value: 'back', label: 'Back' },
                    ]}
                  />
                </div>

                <BadgePreview card={card} qrDataUrl={qrDataUrl} logoUrl={company.logoUrl ?? undefined} company={company} side={side} />

                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={onPhoto} />
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                    <Upload className="size-3.5" />
                    {card.photoUrl ? 'Replace photo' : 'Upload photo'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={regenerate}>
                    <RotateCw className="size-3.5" />
                    Reissue QR code
                  </Button>
                  <Button variant="primary" size="sm" disabled={busy} onClick={printOne}>
                    <Printer className="size-3.5" />
                    Print badge (front &amp; back)
                  </Button>
                </div>

                <p className="mt-4 text-center text-[11px] text-ink-3">
                  Card size is standard CR80 (85.6 × 54mm) — the same size as a bank card. Print at 100% scale, not
                  "fit to page". Printing sends both sides, one per page.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      <PrintStage cards={printQueue} logoUrl={company.logoUrl ?? undefined} company={company} />
      <style>{CARD_CSS}</style>
    </div>
  )
}
