import * as React from 'react'
import {
  Archive, ArchiveRestore, Megaphone, Pencil, Plus, Trash2, TriangleAlert, UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/api'
import {
  archiveVacancy, createRecord, deleteVacancyForGood, getVacancyArchive,
  postingFromRequisition, restoreVacancy, updateRecord,
  type ArchivedVacancy,
} from '@/lib/adminApi'
import { fmtDate } from '@/lib/format'
import { Badge, Button, Combobox, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * The open vacancies, as records rather than as a read-only strip.
 *
 * This was a row of cards you could look at and click through to sourcing, and
 * that was the whole of it: raising a request happened on another page, and
 * changing or withdrawing one could not be done from the application at all.
 * A headcount that was approved for three and is now two, or a vacancy the
 * department has dropped, had to be corrected in the database.
 *
 * So the strip now owns the record. New, edit and delete are here, beside the
 * thing they act on, because a recruiter looking at "2 of 3 seats open" is
 * exactly the person who knows it should say 2 of 2.
 *
 * Vacancies are archived from here, not deleted. The delete button used to
 * refuse almost every time it was pressed — a request with an advert on the
 * careers site was told to close the advert first, one with applicants was
 * told to cancel instead — which was correct about the risk and useless as an
 * answer. People were left with a board of dead vacancies and two jobs to do
 * to clear each one, so nobody cleared any.
 *
 * Archiving does the whole job in one act: the request comes off the board,
 * its advert comes off the careers site, and everything is kept. Destroying a
 * record for good is then a second, deliberate step from inside the archive,
 * where it still refuses if a hire or an application points at it.
 */

type Row = Record<string, unknown>

const STATUSES = ['Draft', 'For Approval', 'Approved', 'Sourcing', 'Filled', 'Cancelled'] as const

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'good' | 'warning' | 'critical'> = {
  Draft: 'neutral',
  'For Approval': 'warning',
  Approved: 'good',
  Sourcing: 'info',
  Filled: 'neutral',
  Cancelled: 'critical',
}

const optionsOf = (rows: Row[], label = 'name') =>
  rows.map((r) => ({
    value: Number(r.id),
    label: String(r[label] ?? r.name ?? r.title ?? r.code ?? ''),
    sublabel: String(r.code ?? ''),
  }))

/* -------------------------------------------------------------------------- */
/* The form, shared by new and edit                                            */
/* -------------------------------------------------------------------------- */

function VacancyDialog({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Null when raising a new one. */
  row: Row | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const editing = row !== null

  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')

  const [positionId, setPositionId] = React.useState<number | null>(null)
  const [departmentId, setDepartmentId] = React.useState<number | null>(null)
  const [branchId, setBranchId] = React.useState<number | null>(null)
  const [headcount, setHeadcount] = React.useState('1')
  const [neededBy, setNeededBy] = React.useState('')
  const [budgetRate, setBudgetRate] = React.useState('')
  const [status, setStatus] = React.useState<string>('Approved')

  const { data: positions = [] } = useResource<Row[]>('hr/positions', () => [])
  const { data: departments = [] } = useResource<Row[]>('hr/departments', () => [])
  const { data: branches = [] } = useResource<Row[]>('hr/branch-units', () => [])

  // Reloaded whenever the dialog opens, so editing one vacancy and then
  // another does not show the first one's numbers.
  React.useEffect(() => {
    if (!open) return

    setProblem('')
    setPositionId(row?.positionId != null ? Number(row.positionId) : null)
    setDepartmentId(row?.departmentId != null ? Number(row.departmentId) : null)
    setBranchId(row?.branchId != null ? Number(row.branchId) : null)
    setHeadcount(String(row?.headcount ?? 1))
    setNeededBy(row?.neededBy ? String(row.neededBy).slice(0, 10) : '')
    setBudgetRate(row?.budgetRate ? String(row.budgetRate) : '')
    setStatus(String(row?.status ?? 'Approved'))
  }, [open, row])

  const filled = Number(row?.filled ?? 0)
  const valid = positionId !== null && departmentId !== null && Number(headcount) >= Math.max(1, filled)

  const submit = async () => {
    setBusy(true)
    setProblem('')

    const values = {
      positionId,
      departmentId,
      ...(branchId ? { branchId } : {}),
      headcount: Number(headcount),
      ...(neededBy ? { neededBy } : {}),
      ...(budgetRate ? { budgetRate: Number(budgetRate) } : {}),
      status,
    }

    try {
      if (editing) {
        await updateRecord('hr/requisitions', Number(row.id), values)
        toast({ tone: 'success', title: `${String(row.no ?? 'Request')} updated` })
      } else {
        await createRecord('hr/requisitions', values)
        toast({ tone: 'success', title: 'Manpower request raised' })
      }

      onSaved()
      onClose()
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Change ${String(row.no ?? 'this request')}` : 'Raise a manpower request'}
      description={
        editing
          ? 'The approved headcount and the details applicants are sourced against.'
          : 'The approved vacancy applicants are sourced against. Seats are counted off it as people are hired.'
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy} loading={busy}>
            {editing ? 'Save changes' : 'Raise request'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="Position" required composite>
          <Combobox
            value={positionId}
            options={optionsOf(positions, 'title')}
            onChange={(v) => setPositionId(v === null ? null : Number(v))}
            placeholder="Which role"
          />
        </Field>
        <Field label="Department" required hint="Where the seat sits." composite>
          <Combobox
            value={departmentId}
            options={optionsOf(departments)}
            onChange={(v) => setDepartmentId(v === null ? null : Number(v))}
            placeholder="Which department"
          />
        </Field>

        <Field label="Branch" composite>
          <Combobox
            value={branchId}
            options={optionsOf(branches)}
            onChange={(v) => setBranchId(v === null ? null : Number(v))}
            placeholder="Where they will be based"
          />
        </Field>
        <Field
          label="Headcount"
          required
          /* A headcount below what has already been hired would make the
             seats-open figure negative, and the two would then disagree
             forever. Said before it is typed rather than after. */
          hint={filled > 0 ? `${filled} already hired, so it cannot go below ${filled}.` : 'How many seats this authorises.'}
        >
          <Input
            type="number"
            min={Math.max(1, filled)}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          />
        </Field>

        <Field label="Needed by">
          <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </Field>
        <Field label="Budget rate" hint="The agreed figure when nothing else is negotiated at offer.">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={budgetRate}
            onChange={(e) => setBudgetRate(e.target.value)}
          />
        </Field>

        <Field
          label="Status"
          required
          hint="Cancelled takes it off the sourcing list without losing the record."
          className="sm:col-span-2"
        >
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {problem && (
        <p role="alert" className="mt-3 text-[12px] text-critical">
          {problem}
        </p>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* The strip                                                                   */
/* -------------------------------------------------------------------------- */

export function OpenVacancies({
  requisitions,
  onChanged,
  onSource,
}: {
  requisitions: Row[]
  onChanged: () => void
  /** Opens the intake form against this vacancy, in its own tab. */
  onSource: (id: number) => void
}) {
  const toast = useToast()

  const [dialog, setDialog] = React.useState<{ open: boolean; row: Row | null }>({ open: false, row: null })
  const [archiving, setArchiving] = React.useState<Row | null>(null)
  const [reason, setReason] = React.useState('')
  const [showArchive, setShowArchive] = React.useState(false)
  const [archive, setArchive] = React.useState<ArchivedVacancy[]>([])
  const [busy, setBusy] = React.useState(false)

  const loadArchive = React.useCallback(() => {
    getVacancyArchive()
      .then((data) => setArchive(data.requisitions))
      .catch(() => setArchive([]))
  }, [])

  React.useEffect(() => {
    loadArchive()
  }, [loadArchive, requisitions])

  // What is still taking candidates. Cancelled and Filled requests stay in the
  // record but have no business on a sourcing strip.
  const open = React.useMemo(
    () => requisitions.filter((r) => ['Approved', 'Sourcing', 'For Approval', 'Draft'].includes(String(r.status))),
    [requisitions],
  )

  const archiveOne = async () => {
    if (!archiving) return

    setBusy(true)
    try {
      const result = await archiveVacancy(Number(archiving.id), reason.trim() || undefined)

      toast({
        // Applicants still in the pipeline against an archived vacancy is
        // something to act on, not something to celebrate.
        tone: result.applicants > 0 ? 'warning' : 'success',
        title: `${result.no} archived`,
        description: result.message,
      })

      setArchiving(null)
      setReason('')
      onChanged()
      loadArchive()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not archive it.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (row: ArchivedVacancy) => {
    setBusy(true)
    try {
      const result = await restoreVacancy(row.id)
      toast({ tone: 'success', title: `${result.no} restored`, description: result.message })
      onChanged()
      loadArchive()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not restore it.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const destroy = async (row: ArchivedVacancy) => {
    setBusy(true)
    try {
      const result = await deleteVacancyForGood(row.id)
      toast({ tone: 'success', title: `${result.no} deleted`, description: result.message })
      loadArchive()
    } catch (err) {
      // The server's refusal names what points at the record. Shown verbatim.
      toast({ tone: 'error', title: 'Could not delete it.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const advertise = async (row: Row) => {
    setBusy(true)
    try {
      const posting = await postingFromRequisition(Number(row.id))
      toast({
        tone: 'success',
        title: 'Advert drafted',
        description: 'Written from this request. Publish it from Job Postings when it reads right.',
      })
      onChanged()
      window.open(`/careers/${posting.slug}`, '_blank', 'noopener')
    } catch (err) {
      toast({ tone: 'error', title: 'Could not draft the advert.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mb-4 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Open vacancies</p>
        <span className="flex items-center gap-1">
          {archive.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowArchive(true)}>
              <Archive className="size-3.5" />
              Archive ({archive.length})
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, row: null })}>
            <Plus className="size-3.5" />
            New request
          </Button>
        </span>
      </div>

      {open.length === 0 ? (
        <p className="py-3 text-center text-[12px] text-ink-3">
          No open vacancies. Raise one to start sourcing against it.
        </p>
      ) : (
        <div className="flex min-w-max gap-2 overflow-x-auto pb-1">
          {open.map((r) => {
            const openings = Number(r.openings ?? 0)

            return (
              <div
                key={Number(r.id)}
                className="min-w-[13rem] rounded-lg border border-line px-3 py-2 transition-colors hover:border-brand-400"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <p className="min-w-0 text-[12px] font-medium text-ink">{String(r.position ?? '—')}</p>
                  <Badge tone={STATUS_TONE[String(r.status)] ?? 'neutral'}>{String(r.status)}</Badge>
                </div>

                <p className="text-[11px] text-ink-3">
                  {String(r.no ?? '')} · {String(r.branch ?? r.department ?? '')}
                </p>

                <p className="mt-1 text-[11px] text-ink-2">
                  <span className={cn('tabular font-semibold', openings === 0 ? 'text-ink-3' : 'text-ink')}>
                    {openings}
                  </span>{' '}
                  of <span className="tabular">{Number(r.headcount ?? 0)}</span> seats open
                  {r.neededBy ? ` · by ${fmtDate(String(r.neededBy))}` : ''}
                </p>

                {/* The four things you do to a vacancy, on the vacancy. */}
                <div className="mt-1.5 flex items-center gap-0.5 border-t border-line pt-1.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Add an applicant against ${String(r.no ?? '')}`}
                    title="Add an applicant against this vacancy"
                    onClick={() => onSource(Number(r.id))}
                  >
                    <UserPlus className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Draft an advert for ${String(r.no ?? '')}`}
                    title="Draft a careers-site advert from this request"
                    disabled={busy}
                    onClick={() => void advertise(r)}
                  >
                    <Megaphone className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Change ${String(r.no ?? '')}`}
                    title="Change the headcount or details"
                    onClick={() => setDialog({ open: true, row: r })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Archive ${String(r.no ?? '')}`}
                    title="Take it off the board and its advert off the careers site"
                    onClick={() => setArchiving(r)}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <VacancyDialog
        open={dialog.open}
        row={dialog.row}
        onClose={() => setDialog({ open: false, row: null })}
        onSaved={onChanged}
      />

      <Modal
        open={archiving !== null}
        onClose={() => {
          setArchiving(null)
          setReason('')
        }}
        title={`Archive ${String(archiving?.no ?? 'this request')}?`}
        description="It comes off the board and its advert comes off the careers site. Nothing is lost — the approved headcount, who raised it and anybody who applied are all kept, and you can bring it back."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setArchiving(null)
                setReason('')
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={() => void archiveOne()} disabled={busy} loading={busy}>
              <Archive className="size-4" />
              Archive it
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-ink-2">
            {String(archiving?.position ?? '')} · {Number(archiving?.headcount ?? 0)} seat
            {Number(archiving?.headcount ?? 0) === 1 ? '' : 's'}
            {Number(archiving?.filled ?? 0) > 0 ? `, ${Number(archiving?.filled)} already hired` : ''}
          </p>

          <Field
            label="Why"
            hint="Optional, and worth a line. An archive of unexplained records is a list nobody can act on later."
            composite
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Budget pulled for the quarter · Raised by mistake · Filled internally"
            />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------------------------------------- */}
      <Modal
        open={showArchive}
        onClose={() => setShowArchive(false)}
        title="Archived vacancies"
        description="Off the board and off the careers site, but kept. Restore one to put it back, or delete it for good when nothing points at it any more."
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setShowArchive(false)}>
            Close
          </Button>
        }
      >
        {archive.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-3">Nothing archived.</p>
        ) : (
          <div className="space-y-2">
            {archive.map((row) => (
              <div key={row.id} className="rounded-lg border border-line p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      {row.position ?? '—'}
                      <span className="ml-1.5 text-[11px] font-normal text-ink-3">{row.no}</span>
                    </p>
                    <p className="text-[11px] text-ink-3">
                      {[row.branch, row.department].filter(Boolean).join(' · ')}
                      {row.archivedAt && ` · archived ${fmtDate(row.archivedAt)}`}
                      {row.archivedBy && ` by ${row.archivedBy}`}
                    </p>
                    {row.reason && (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{row.reason}</p>
                    )}
                    {(row.applicants > 0 || row.adverts > 0) && (
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        {row.applicants > 0 &&
                          `${row.applicants} applicant${row.applicants === 1 ? '' : 's'}`}
                        {row.applicants > 0 && row.adverts > 0 && ' · '}
                        {row.adverts > 0 && `${row.adverts} advert${row.adverts === 1 ? '' : 's'}`}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void restore(row)}>
                      <ArchiveRestore className="size-3.5" />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-critical"
                      disabled={busy || row.blockedFrom !== null}
                      title={row.blockedFrom ?? 'Delete this record for good'}
                      onClick={() => void destroy(row)}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Why it cannot go, said on the row rather than only in a
                    tooltip on a disabled button nobody can hover on a phone. */}
                {row.blockedFrom && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
                    <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
                    {row.blockedFrom}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
