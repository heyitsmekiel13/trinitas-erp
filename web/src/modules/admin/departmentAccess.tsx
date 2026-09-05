import * as React from 'react'
import { Check, Network, Plus, TriangleAlert, X } from 'lucide-react'
import { DEPARTMENT_BY_ID, DEPARTMENTS } from '@/app/registry'
import * as api from '@/lib/adminApi'
import { liveApi } from '@/lib/adminApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, CardHeader, Input, Switch } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'

const OFFLINE_MESSAGE =
  'These settings are stored in MySQL. Run SETUP DATABASE.bat, start the API, then set VITE_API_URL in web/.env so the app reads and writes live data.'

/**
 * Which business departments each real org-chart department may see.
 *
 * This screen is a courtesy for the sidebar and nothing else — the actual
 * refusal happens server-side in `department-access` middleware, which
 * answers 404 to a department a caller isn't allowed to reach whether or
 * not this screen ever ran. See DepartmentAccessGuard on the API.
 */
export function DepartmentAccess() {
  const toast = useToast()
  const [settings, setSettings] = React.useState<api.DepartmentAccessSettings | null>(null)
  const [rows, setRows] = React.useState<api.DepartmentAccessRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [savingSettings, setSavingSettings] = React.useState(false)
  const [newRole, setNewRole] = React.useState('')
  const [savingRow, setSavingRow] = React.useState<number | null>(null)

  const refresh = React.useCallback(async () => {
    const [s, index] = await Promise.all([api.getDepartmentAccessSettings(), api.listDepartmentAccess()])
    setSettings(s)
    setRows(index.departments)
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)
      return
    }
    let cancelled = false
    refresh()
      .then(() => !cancelled && setLoading(false))
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const saveSettings = async (next: Partial<api.DepartmentAccessSettings>) => {
    if (!settings) return
    const merged = { ...settings, ...next }
    setSettings(merged)
    setSavingSettings(true)
    try {
      const saved = await api.saveDepartmentAccessSettings(next)
      setSettings(saved)
      toast({ tone: 'success', title: 'Department access settings saved' })
    } catch (e) {
      setSettings(settings)
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setSavingSettings(false)
    }
  }

  const addBypassRole = () => {
    const role = newRole.trim()
    if (!role || !settings || settings.bypass_roles.includes(role)) return
    setNewRole('')
    void saveSettings({ bypass_roles: [...settings.bypass_roles, role] })
  }

  const removeBypassRole = (role: string) => {
    if (!settings) return
    void saveSettings({ bypass_roles: settings.bypass_roles.filter((r) => r !== role) })
  }

  const toggleRowDepartment = (row: api.DepartmentAccessRow, deptId: string) => {
    const allowed = row.allowedDepartments.includes(deptId)
      ? row.allowedDepartments.filter((d) => d !== deptId)
      : [...row.allowedDepartments, deptId]
    void saveRow(row, { allowedDepartments: allowed, seesAll: row.seesAll })
  }

  const toggleRowSeesAll = (row: api.DepartmentAccessRow, on: boolean) => {
    void saveRow(row, { allowedDepartments: row.allowedDepartments, seesAll: on })
  }

  const saveRow = async (row: api.DepartmentAccessRow, values: { allowedDepartments: string[]; seesAll: boolean }) => {
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...values, configured: true } : r)) ?? prev)
    setSavingRow(row.id)
    try {
      const saved = await api.saveDepartmentAccessRule(row.id, values)
      setRows((prev) => prev?.map((r) => (r.id === row.id ? saved : r)) ?? prev)
    } catch (e) {
      toast({ tone: 'error', title: `Could not update ${row.name}`, description: (e as Error).message })
      void refresh()
    } finally {
      setSavingRow(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Department Access"
        description="Restrict each org-chart department to the parts of the ERP it needs, so one department's staff cannot browse another's data."
        meta={
          !liveApi() && (
            <Badge tone="warning" dot>
              Preview data — not connected to MySQL
            </Badge>
          )
        }
      />

      {!liveApi() ? (
        <Card className="p-5">
          <EmptyState icon={Network} title="Not connected to the database yet" description={OFFLINE_MESSAGE} />
        </Card>
      ) : loading ? (
        <Card className="h-64 shimmer" />
      ) : error || !settings || !rows ? (
        <Card className="p-5">
          <p className="flex items-center gap-1.5 text-sm text-critical">
            <TriangleAlert className="size-3.5 shrink-0" />
            {error}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Restrict department access"
              subtitle="Off by default. Configure the mapping below before switching this on — an account whose department has no rule yet sees nothing beyond its own tools once enabled."
            />
            <div className="space-y-4 px-5 pb-5">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3.5">
                <span>
                  <span className="block text-[13px] font-medium text-ink">Enable department restriction</span>
                  <span className="block text-xs text-ink-3">
                    Once on, every account may only reach the departments granted below.
                  </span>
                </span>
                <Switch
                  checked={settings.enabled}
                  onChange={(on) => !savingSettings && saveSettings({ enabled: on })}
                  label="Enable department restriction"
                  className={savingSettings ? 'pointer-events-none opacity-60' : undefined}
                />
              </label>

              <div>
                <p className="text-[13px] font-medium text-ink">Roles that always see everything</p>
                <p className="text-xs text-ink-3">
                  Super administrators bypass this automatically. Add role codes here for anyone else who needs
                  cross-department oversight — e.g. Process &amp; Performance or Executive.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {settings.bypass_roles.map((role) => (
                    <span
                      key={role}
                      className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-1.5 pl-3 text-xs font-medium text-ink"
                    >
                      {role}
                      <button
                        type="button"
                        onClick={() => removeBypassRole(role)}
                        aria-label={`Remove ${role}`}
                        className="rounded-full p-0.5 text-ink-3 hover:bg-surface-3 hover:text-critical"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2.5 flex gap-2">
                  <Input
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    placeholder="role code, e.g. process-manager"
                    className="max-w-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addBypassRole()
                      }
                    }}
                  />
                  <Button variant="secondary" size="sm" disabled={!newRole.trim()} onClick={addBypassRole}>
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Department mapping" subtitle={`${rows.length} org-chart departments`} />
            <div className="divide-y divide-line border-t border-line">
              {rows.map((row) => (
                <div key={row.id} className="space-y-2.5 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{row.name}</span>
                    {!row.configured && (
                      <Badge tone="warning" dot>
                        Unconfigured — sees nothing
                      </Badge>
                    )}
                    <label className="ml-auto flex items-center gap-2 text-xs text-ink-3">
                      Sees everything
                      <Switch
                        checked={row.seesAll}
                        onChange={(on) => savingRow !== row.id && toggleRowSeesAll(row, on)}
                        label={`${row.name} sees everything`}
                        className={savingRow === row.id ? 'pointer-events-none opacity-60' : undefined}
                      />
                    </label>
                  </div>
                  {!row.seesAll && (
                    <div className="flex flex-wrap gap-1.5">
                      {DEPARTMENTS.map((dept) => {
                        const on = row.allowedDepartments.includes(dept.id)
                        return (
                          <button
                            key={dept.id}
                            type="button"
                            disabled={savingRow === row.id}
                            onClick={() => toggleRowDepartment(row, dept.id)}
                            className={
                              on
                                ? 'flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800'
                                : 'flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink'
                            }
                          >
                            {on && <Check className="size-3" />}
                            {DEPARTMENT_BY_ID[dept.id]?.short ?? dept.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
