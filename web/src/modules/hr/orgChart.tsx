import * as React from 'react'
import { ChevronDown, ChevronRight, GripVertical, LayoutGrid, List, Search, Users, UserX } from 'lucide-react'
import { useResource } from '@/lib/api'
import { cn } from '@/lib/cn'
import { reassignOrgChartManager, type OrgChartEmployee } from '@/lib/adminApi'
import { Avatar, Badge, Button, Combobox } from '@/components/ui/primitives'
import { EmptyState, ErrorState, SkeletonDashboard, useToast } from '@/components/ui/feedback'
import { OrgChartCanvas } from './orgChartCanvas'

/**
 * The reporting line, drawn rather than tabulated.
 *
 * Built from the same `reports_to_id` the masterfile already carries — no new
 * data entry, just a different view of it. A flat list of ~100+ people is
 * walked into a tree client-side (see `buildForest`) rather than asking the
 * server to recurse an unknown-depth chain of `with('manager.manager...')`.
 */

type Node = OrgChartEmployee & { children: Node[] }

function buildForest(rows: OrgChartEmployee[]): Node[] {
  const byId = new Map<number, Node>(rows.map((r) => [r.id, { ...r, children: [] }]))
  const roots: Node[] = []

  for (const node of byId.values()) {
    const parent = node.reportsToId != null ? byId.get(node.reportsToId) : null
    // No manager, or a manager who isn't in the active roster (separated, or
    // never imported) — either way there's nothing to hang this node under,
    // so it becomes a root of its own rather than silently vanishing.
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const byName = (a: Node, b: Node) => a.name.localeCompare(b.name)
  const sortDeep = (list: Node[]) => {
    list.sort(byName)
    list.forEach((n) => sortDeep(n.children))
  }
  sortDeep(roots)

  return roots
}

/** Every id on the path from a root down to `id`, inclusive. */
function ancestorChain(rows: OrgChartEmployee[], id: number): number[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const chain: number[] = []
  let current: OrgChartEmployee | undefined = byId.get(id)
  while (current) {
    chain.push(current.id)
    current = current.reportsToId != null ? byId.get(current.reportsToId) : undefined
  }
  return chain
}

function PersonCard({
  node,
  expanded,
  onToggle,
  highlighted,
  dragState,
}: {
  node: Node
  expanded: boolean
  onToggle: () => void
  highlighted: boolean
  /** Undefined when this tree is read-only (drag reparenting not wired up). */
  dragState?: {
    draggingId: number | null
    dragOverId: number | null
    onDragStart: (id: number) => void
    onDragEnd: () => void
    onDragOver: (id: number) => void
    onDrop: (id: number) => void
  }
}) {
  const hasChildren = node.children.length > 0
  const draggable = dragState !== undefined
  const isDragging = dragState?.draggingId === node.id
  // Dropping a manager onto their own descendant is refused server-side
  // anyway, but hinting it here means the cursor never even looks droppable.
  const isDropTarget = dragState?.dragOverId === node.id && dragState.draggingId !== node.id

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        dragState?.onDragStart(node.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => dragState?.onDragEnd()}
      onDragOver={(e) => {
        if (!draggable) return
        e.preventDefault()
        dragState?.onDragOver(node.id)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragState?.onDrop(node.id)
      }}
      className={cn(
        'flex items-center gap-2.5 rounded-xl border border-line bg-surface p-2.5 pr-3.5 shadow-[0_1px_2px_rgb(13_15_20/0.04)] transition-colors',
        highlighted && 'ring-2 ring-brand-500',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
        isDropTarget && 'border-brand-400 bg-brand-50 ring-2 ring-brand-400 dark:bg-brand-950',
      )}
    >
      {draggable && <GripVertical className="size-3.5 shrink-0 text-ink-3" />}

      <button
        type="button"
        onClick={onToggle}
        disabled={!hasChildren}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3',
          hasChildren ? 'hover:bg-surface-3 hover:text-ink' : 'invisible',
        )}
        aria-label={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>

      {node.photoUrl ? (
        <img src={node.photoUrl} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
      ) : (
        <Avatar name={node.name} size="md" />
      )}

      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink">{node.name}</p>
        <p className="truncate text-[11px] text-ink-3">
          {node.title ?? 'No position on file'}
          {node.department ? ` · ${node.department}` : ''}
        </p>
      </div>

      {hasChildren && (
        <Badge tone="neutral" className="ml-1 shrink-0">
          {node.children.length}
        </Badge>
      )}
    </div>
  )
}

function TreeNode({
  node,
  depth,
  expandedIds,
  toggle,
  highlightId,
  dragState,
}: {
  node: Node
  depth: number
  expandedIds: Set<number>
  toggle: (id: number) => void
  highlightId: number | null
  dragState?: React.ComponentProps<typeof PersonCard>['dragState']
}) {
  const expanded = expandedIds.has(node.id)

  return (
    <div>
      <PersonCard
        node={node}
        expanded={expanded}
        onToggle={() => toggle(node.id)}
        highlighted={node.id === highlightId}
        dragState={dragState}
      />
      {expanded && node.children.length > 0 && (
        <div className="mt-2 ml-[18px] space-y-2 border-l border-line pl-4">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              toggle={toggle}
              highlightId={highlightId}
              dragState={dragState}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The searchable, expand/collapse list view — good for finding one person
 * fast in a large company, and now the place to actually fix a reporting
 * line: drag a row onto another and it becomes their manager, or onto the
 * "Make a root" strip at the top to clear it. Every drop is a real change
 * to the 201 file, checked server-side against creating a cycle — nothing
 * here silently accepts a drop that would leave two people each other's
 * boss.
 */
function OrgChartTree({ data, onReparented }: { data: OrgChartEmployee[]; onReparented: () => void }) {
  const toast = useToast()
  const [query, setQuery] = React.useState('')
  const [expandedIds, setExpandedIds] = React.useState<Set<number> | null>(null)
  const [draggingId, setDraggingId] = React.useState<number | null>(null)
  const [dragOverId, setDragOverId] = React.useState<number | null>(null)
  const [dragOverRoot, setDragOverRoot] = React.useState(false)

  const byId = React.useMemo(() => new Map(data.map((r) => [r.id, r])), [data])

  const drop = async (employeeId: number, managerId: number | null) => {
    const current = byId.get(employeeId)
    if (!current || current.reportsToId === managerId) return

    try {
      await reassignOrgChartManager(employeeId, managerId)
      onReparented()
      toast({
        tone: 'success',
        title: managerId
          ? `${current.name} now reports to ${byId.get(managerId)?.name ?? 'that person'}`
          : `${current.name} is now a root — nobody above them`,
      })
    } catch (e) {
      toast({ tone: 'error', title: "Couldn't move them there", description: (e as Error).message })
    }
  }

  const dragState = {
    draggingId,
    dragOverId,
    onDragStart: (id: number) => setDraggingId(id),
    onDragEnd: () => {
      setDraggingId(null)
      setDragOverId(null)
      setDragOverRoot(false)
    },
    onDragOver: (id: number) => setDragOverId(id),
    onDrop: (targetId: number) => {
      if (draggingId != null) void drop(draggingId, targetId)
      setDraggingId(null)
      setDragOverId(null)
    },
  }

  const forest = React.useMemo(() => buildForest(data ?? []), [data])

  // Everyone with a direct report starts open, one level deep — enough to
  // orient without a 100-person tree unrolling to full depth on first load.
  const defaultExpanded = React.useMemo(() => {
    const ids = new Set<number>()
    for (const root of forest) {
      ids.add(root.id)
      for (const child of root.children) ids.add(child.id)
    }
    return ids
  }, [forest])

  const expanded = expandedIds ?? defaultExpanded

  const toggle = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedIds(next)
  }

  const match = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !data) return null
    return data.find((r) => r.name.toLowerCase().includes(q)) ?? null
  }, [query, data])

  React.useEffect(() => {
    if (!match || !data) return
    const chain = ancestorChain(data, match.id)
    setExpandedIds((prev) => new Set([...(prev ?? defaultExpanded), ...chain]))
    // Only re-run when the match itself changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a person…"
            className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 text-[13px] text-ink outline-none focus:border-brand-400"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setExpandedIds(new Set(data.map((r) => r.id)))}>
            Expand all
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExpandedIds(new Set())}>
            Collapse all
          </Button>
        </div>
      </div>

      {draggingId != null && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOverRoot(true)
          }}
          onDragLeave={() => setDragOverRoot(false)}
          onDrop={(e) => {
            e.preventDefault()
            void drop(draggingId, null)
            setDraggingId(null)
            setDragOverId(null)
            setDragOverRoot(false)
          }}
          className={cn(
            'mb-3 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed p-3 text-[12.5px] font-medium transition-colors',
            dragOverRoot ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300' : 'border-line text-ink-3',
          )}
        >
          <UserX className="size-4" />
          Drop here to make them a root — nobody above them
        </div>
      )}

      {forest.length === 0 ? (
        <EmptyState icon={Users} title="No active employees" description="Nobody active has a position on file yet." />
      ) : (
        <div className="space-y-4">
          {forest.map((root) => (
            <TreeNode
              key={root.id}
              node={root}
              depth={0}
              expandedIds={expanded}
              toggle={toggle}
              highlightId={match?.id ?? null}
              dragState={dragState}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The company picker and the Canvas/Tree switch — the one thing every real
 * business here needed that a single flat chart couldn't give it. Panadero,
 * Premium Kitchen Equipment and the rest each have their own structure, and
 * `businessGroupId` on the 201 file is what actually tells them apart; this
 * just reads it back as a filter rather than inventing a second place to
 * record which company somebody works for.
 */
export function OrgChart() {
  const { data, isLoading, error, refetch } = useResource<OrgChartEmployee[]>('hr/org-chart', () => {
    throw new Error('The org chart needs a live connection to the server.')
  })
  const { data: groups = [] } = useResource<{ id: number; name: string; code: string }[]>('hr/business-groups', () => [])

  const [view, setView] = React.useState<'canvas' | 'tree'>('canvas')
  const [businessGroupId, setBusinessGroupId] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (businessGroupId == null && groups.length > 0) setBusinessGroupId(groups[0].id)
  }, [groups, businessGroupId])

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const activeGroupName = groups.find((g) => g.id === businessGroupId)?.name ?? null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-xs">
          <Combobox
            value={businessGroupId}
            options={groups.map((g) => ({ value: g.id, label: g.name, sublabel: g.code }))}
            onChange={(v) => setBusinessGroupId(v === null ? null : Number(v))}
            placeholder="Choose a company…"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
          <button
            type="button"
            onClick={() => setView('canvas')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              view === 'canvas' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <LayoutGrid className="size-3.5" />
            Canvas
          </button>
          <button
            type="button"
            onClick={() => setView('tree')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
              view === 'tree' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <List className="size-3.5" />
            Tree
          </button>
        </div>
      </div>

      {view === 'canvas' ? (
        <OrgChartCanvas rows={data} businessGroupId={businessGroupId} businessGroupName={activeGroupName} />
      ) : (
        <OrgChartTree
          data={businessGroupId ? data.filter((r) => r.businessGroupId === businessGroupId) : data}
          onReparented={() => void refetch()}
        />
      )}
    </div>
  )
}
