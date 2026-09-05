import * as React from 'react'
import {
  Database,
  DatabaseBackup,
  Download,
  Eraser,
  HardDriveDownload,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import * as api from '@/lib/adminApi'
import { liveApi } from '@/lib/adminApi'
import { API_BASE_URL } from '@/lib/api'
import { fmtDateTime, num } from '@/lib/format'
import { PageHeader, SectionHeading } from '@/components/layout/PageHeader'
import { Badge, Button, Card, CardHeader, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'

/* -------------------------------------------------------------------------- */
/* Typed confirmation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Destructive actions require the exact phrase to be typed.
 *
 * A checkbox or a plain "Are you sure?" gets clicked through on autopilot.
 * Typing CLEAR TRANSACTIONAL DATA is not something anyone does by accident.
 */
function DangerConfirm({
  open,
  onClose,
  onConfirm,
  phrase,
  title,
  description,
  consequences,
  actionLabel,
  busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  phrase: string
  title: string
  description?: string
  consequences: string[]
  actionLabel: string
  busy: boolean
}) {
  const [typed, setTyped] = React.useState('')

  React.useEffect(() => {
    if (open) setTyped('')
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={typed !== phrase} loading={busy}>
            {actionLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2 rounded-xl bg-critical/8 p-3.5 ring-1 ring-critical/20 ring-inset">
          {consequences.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[13px] text-ink-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-critical" />
              {line}
            </li>
          ))}
        </ul>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-2">
            Type <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-ink">{phrase}</code> to continue
          </span>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={phrase}
            className="font-mono"
          />
        </label>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number) {
  if (bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const KIND_TONE = {
  manual: 'brand',
  scheduled: 'info',
  'pre-restore': 'warning',
} as const

export function BackupRestore() {
  const toast = useToast()
  const [data, setData] = React.useState<api.BackupIndex | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [restoreTarget, setRestoreTarget] = React.useState<api.BackupRecord | null>(null)
  const [clearOpen, setClearOpen] = React.useState(false)
  const [clearMasterfileOpen, setClearMasterfileOpen] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setData(await api.listBackups())
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)
      return
    }
    refresh()
      .catch((e: Error) => toast({ tone: 'error', title: 'Could not load backups', description: e.message }))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (action: () => Promise<unknown>, success: string, description?: string) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      toast({ tone: 'success', title: success, description })
    } catch (e) {
      toast({ tone: 'error', title: 'That did not work', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!liveApi()) {
    return (
      <div>
        <PageHeader
          title="Backup & Restore"
          description="Take a copy of the database, put one back, or clear the data you loaded while testing."
        />
        <Card className="p-5">
          <EmptyState
            icon={Database}
            title="Not connected to the database yet"
            description="Backups run against the live database through the API. Run SETUP DATABASE.bat, start the API, then set VITE_API_URL in web/.env."
          />
          <div className="mx-auto max-w-md rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">web/.env</p>
            <code className="mt-1.5 block font-mono text-xs text-ink">VITE_API_URL={API_BASE_URL}</code>
          </div>
        </Card>
      </div>
    )
  }

  if (loading) return <div className="shimmer h-96 rounded-[var(--radius-card)]" />

  const backups = data?.backups ?? []
  const inventory = Object.entries(data?.inventory ?? {})
  const totalRows = inventory.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div>
      <PageHeader
        title="Backup & Restore"
        description="Take a copy of the database, put one back, or clear the data you loaded while testing."
        meta={
          <>
            <Badge tone="neutral">{data?.driver}</Badge>
            <Badge tone={data?.mysqldump ? 'good' : 'info'} dot>
              {data?.mysqldump ? 'mysqldump available' : 'built-in exporter'}
            </Badge>
            <Badge tone="neutral">{num(totalRows)} rows across {inventory.length} tables</Badge>
          </>
        }
        actions={
          <>
            <label className="cursor-pointer">
              <span
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-2',
                  busy && 'pointer-events-none opacity-60',
                )}
              >
                <Upload className="size-3.5" />
                <span className="hidden sm:inline">Upload .sql</span>
              </span>
              <input
                type="file"
                accept=".sql,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    void run(() => api.uploadBackup(file), 'File uploaded', 'Use Restore to apply it.')
                    e.target.value = ''
                  }
                }}
              />
            </label>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => run(api.createBackup, 'Backup created')}
            >
              <DatabaseBackup className="size-3.5" />
              Back up now
            </Button>
          </>
        }
      />

      {/* ------------------------------ Backups ------------------------------ */}
      <Card className="overflow-hidden">
        <CardHeader title="Saved backups" subtitle={`${backups.length} on file · newest first`} />
        {backups.length === 0 ? (
          <EmptyState
            icon={HardDriveDownload}
            title="No backups yet"
            description="Take one now, and always before you import data or make a large change."
          />
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[46rem] text-[13px]">
              <thead className="bg-surface-2">
                <tr className="border-b border-line">
                  {['File', 'Type', 'Size', 'Created', ''].map((h, i) => (
                    <th
                      key={h || i}
                      className={cn(
                        'px-4 py-2.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase',
                        i === 2 ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[12px] text-ink">{backup.filename}</span>
                      {backup.status === 'Failed' && (
                        <span className="mt-0.5 block text-[11px] text-critical">{backup.error}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={KIND_TONE[backup.kind]}>{backup.kind}</Badge>
                    </td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{formatBytes(backup.size_bytes)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">{fmtDateTime(backup.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Download ${backup.filename}`}
                          disabled={backup.status !== 'Completed'}
                          onClick={() =>
                            api
                              .downloadBackup(backup)
                              .catch((e: Error) => toast({ tone: 'error', title: 'Download failed', description: e.message }))
                          }
                        >
                          <Download className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Restore ${backup.filename}`}
                          disabled={backup.status !== 'Completed'}
                          onClick={() => setRestoreTarget(backup)}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${backup.filename}`}
                          onClick={() => run(() => api.deleteBackup(backup.id), 'Backup deleted')}
                        >
                          <Trash2 className="size-4 text-critical" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ----------------------------- Inventory ----------------------------- */}
      <div className="mt-6">
        <SectionHeading title="What is in the database" description="Row counts per table, largest first." />
        <Card className="p-4">
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {inventory.slice(0, 24).map(([table, count]) => (
              <div key={table} className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1">
                <span className="truncate font-mono text-[12px] text-ink-2">{table}</span>
                <span className="tabular shrink-0 text-[12px] font-medium text-ink">{num(count)}</span>
              </div>
            ))}
          </div>
          {inventory.length > 24 && (
            <p className="mt-3 text-xs text-ink-3">and {inventory.length - 24} more tables</p>
          )}
        </Card>
      </div>

      {/* ---------------------------- Danger zone ---------------------------- */}
      <div className="mt-6">
        <SectionHeading
          title="Danger zone"
          description="Both actions take a snapshot first, so nothing here is unrecoverable."
        />
        <Card className="border-critical/25 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <p className="text-[13px] font-semibold text-ink">Clear transactional data</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
                Removes every document — orders, invoices, payslips, stock movements, work orders and the audit trail —
                while keeping your company structure, branches, positions, users and settings. This is what you run
                after piloting the system, right before going live with real data.
              </p>
            </div>
            <Button variant="danger" size="sm" onClick={() => setClearOpen(true)} disabled={busy}>
              <Eraser className="size-3.5" />
              Clear data
            </Button>
          </div>
        </Card>

        <Card className="mt-3 border-critical/25 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-xl">
              <p className="text-[13px] font-semibold text-ink">Clear transactional data and the masterfile</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
                Everything the button above removes, plus every employee record and 201 file. Company structure,
                roles, settings and administrator sign-ins are still kept — this is for starting the masterfile
                itself over, not for resetting the system's configuration.
              </p>
            </div>
            <Button variant="danger" size="sm" onClick={() => setClearMasterfileOpen(true)} disabled={busy}>
              <Eraser className="size-3.5" />
              Clear data and masterfile
            </Button>
          </div>
        </Card>
      </div>

      {/* ----------------------------- Confirmations ------------------------- */}
      <DangerConfirm
        open={restoreTarget != null}
        onClose={() => setRestoreTarget(null)}
        busy={busy}
        phrase="RESTORE"
        title="Restore this backup?"
        description={restoreTarget?.filename}
        actionLabel="Restore database"
        consequences={[
          'Everything currently in the database is replaced by the contents of this file.',
          'A snapshot of the current state is saved first, so this can be undone.',
          'Anyone using the system right now will see the restored data immediately.',
        ]}
        onConfirm={() =>
          run(
            () => api.restoreBackup(restoreTarget!.id),
            'Database restored',
            'A pre-restore snapshot was saved.',
          ).then(() => setRestoreTarget(null))
        }
      />

      <DangerConfirm
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        busy={busy}
        phrase="CLEAR TRANSACTIONAL DATA"
        title="Clear all transactional data?"
        description="Documents and history will be removed."
        actionLabel="Clear data"
        consequences={[
          'All orders, invoices, payslips, stock movements and work orders are deleted.',
          'The audit trail and email log are cleared.',
          'Company structure, branches, positions, users and settings are kept.',
          'A snapshot is saved first, so this can be undone.',
        ]}
        onConfirm={() =>
          run(() => api.clearTransactional(), 'Transactional data cleared').then(() => setClearOpen(false))
        }
      />

      <DangerConfirm
        open={clearMasterfileOpen}
        onClose={() => setClearMasterfileOpen(false)}
        busy={busy}
        phrase="CLEAR TRANSACTIONAL DATA AND MASTERFILE"
        title="Clear transactional data and the masterfile?"
        description="Documents, history and every employee record will be removed."
        actionLabel="Clear data and masterfile"
        consequences={[
          'All orders, invoices, payslips, stock movements and work orders are deleted.',
          'Every employee record and 201 file is deleted — this cannot be undone by editing, only by restoring the snapshot below.',
          'The audit trail and email log are cleared.',
          'Company structure, roles, settings and the administrator account are kept.',
          'A snapshot is saved first, so this can be undone.',
        ]}
        onConfirm={() =>
          run(() => api.clearTransactional(true), 'Transactional data and masterfile cleared').then(() =>
            setClearMasterfileOpen(false),
          )
        }
      />
    </div>
  )
}
