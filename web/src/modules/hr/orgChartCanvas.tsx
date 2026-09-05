import * as React from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useViewport,
  type Node,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Users } from 'lucide-react'
import { getCompanySettings, saveOrgChartPosition, type OrgChartEmployee } from '@/lib/adminApi'
import { Avatar } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'

/**
 * The org chart as a canvas you actually arrange, not a list you read.
 *
 * Two things are deliberately kept apart. `reportsToId` — the 201 file's own
 * reporting line — decides who a connecting line runs to; nothing here can
 * change it, because a card sliding across the screen must never silently
 * reassign somebody's manager. `orgChartX/Y` is only where the card happens
 * to sit, saved per employee the moment a drag ends. A chart nobody has
 * arranged yet computes a clean hierarchical layout on its own; the moment
 * somebody drags a card, that person's position is remembered from then on,
 * and everyone else keeps whatever position they already have — dragged or
 * computed — rather than the whole tree re-flowing under them.
 */

const NODE_W = 208
const NODE_H = 84
const H_GAP = 28
const V_GAP = 96

/** How close a dragged card has to get to another card's edge before it snaps to it — screen pixels, independent of zoom. */
const SNAP_PX = 8

type PersonData = {
  label: string
  title: string | null
  department: string | null
  photoUrl: string | null
  isRoot: boolean
}

function PersonNode({ data }: NodeProps<Node<PersonData>>) {
  return (
    <div
      className={
        data.isRoot
          ? 'flex w-52 items-center gap-2.5 rounded-xl border-2 border-brand-400 bg-brand-50 p-2.5 shadow-[0_2px_8px_rgb(13_15_20/0.08)] dark:bg-brand-950'
          : 'flex w-52 items-center gap-2.5 rounded-xl border border-line bg-surface p-2.5 shadow-[0_1px_3px_rgb(13_15_20/0.06)]'
      }
    >
      <Handle type="target" position={Position.Top} className="!bg-ink-3" />
      {data.photoUrl ? (
        <img src={data.photoUrl} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
      ) : (
        <Avatar name={data.label} size="md" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-ink">{data.label}</p>
        {data.title && <p className="truncate text-[11px] text-ink-2">{data.title}</p>}
        {data.department && <p className="truncate text-[10px] text-ink-3">{data.department}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-ink-3" />
    </div>
  )
}

const NODE_TYPES = { person: PersonNode }

/**
 * A simple, honest tree layout: a leaf sits next to its siblings; a parent
 * centres over its children. No attempt at a fully balanced Reingold–Tilford
 * layout — this only has to look like an org chart, not win a graph-drawing
 * contest, and a straightforward recursive placement reads cleanly for the
 * depth any real reporting line actually reaches.
 */
function layoutTree(rootIds: number[], childrenOf: Map<number, number[]>): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number }>()
  let cursor = 0

  const place = (id: number, depth: number): number => {
    const kids = childrenOf.get(id) ?? []
    let x: number

    if (kids.length === 0) {
      x = cursor
      cursor += NODE_W + H_GAP
    } else {
      const centers = kids.map((k) => place(k, depth + 1))
      x = (centers[0] + centers[centers.length - 1]) / 2
    }

    positions.set(id, { x, y: depth * (NODE_H + V_GAP) })
    return x
  }

  for (const root of rootIds) place(root, 0)

  return positions
}

/**
 * "Magnetize" — while a card is being dragged, pull it into line with
 * whichever other card's left edge or top edge it has drifted closest to,
 * the moment that gap is inside `SNAP_PX` at the current zoom. Left/top
 * edges rather than centres: an org chart reads as rows and columns, and
 * two cards sharing a left edge is what actually looks aligned once they're
 * different widths' worth of text.
 */
function magnetize(
  draggedId: string,
  position: { x: number; y: number },
  others: Node<PersonData>[],
  zoom: number,
): { position: { x: number; y: number }; guideX: number | null; guideY: number | null } {
  const threshold = SNAP_PX / Math.max(zoom, 0.01)
  let x = position.x
  let y = position.y
  let bestDx = threshold
  let bestDy = threshold
  let guideX: number | null = null
  let guideY: number | null = null

  for (const other of others) {
    if (other.id === draggedId) continue

    const dx = Math.abs(other.position.x - position.x)
    if (dx < bestDx) {
      bestDx = dx
      x = other.position.x
      guideX = other.position.x
    }

    const dy = Math.abs(other.position.y - position.y)
    if (dy < bestDy) {
      bestDy = dy
      y = other.position.y
      guideY = other.position.y
    }
  }

  return { position: { x, y }, guideX, guideY }
}

/** The faint alignment line a magnetized drag snapped to — flow coordinates, converted to screen pixels via the current pan/zoom. */
function GuideLines({ guideX, guideY }: { guideX: number | null; guideY: number | null }) {
  const { x: panX, y: panY, zoom } = useViewport()

  return (
    <>
      {guideX != null && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-brand-500/70"
          style={{ left: guideX * zoom + panX }}
        />
      )}
      {guideY != null && (
        <div
          className="pointer-events-none absolute right-0 left-0 h-px bg-brand-500/70"
          style={{ top: guideY * zoom + panY }}
        />
      )}
    </>
  )
}

function Canvas({ rows, businessGroupId }: { rows: OrgChartEmployee[]; businessGroupId: number }) {
  const scoped = React.useMemo(() => rows.filter((r) => r.businessGroupId === businessGroupId), [rows, businessGroupId])

  const childrenOf = React.useMemo(() => {
    const map = new Map<number, number[]>()
    for (const r of scoped) {
      if (r.reportsToId == null) continue
      const list = map.get(r.reportsToId) ?? []
      list.push(r.id)
      map.set(r.reportsToId, list)
    }
    return map
  }, [scoped])

  const rootIds = React.useMemo(
    () => scoped.filter((r) => r.reportsToId == null || !scoped.some((s) => s.id === r.reportsToId)).map((r) => r.id),
    [scoped],
  )

  const computed = React.useMemo(() => layoutTree(rootIds, childrenOf), [rootIds, childrenOf])

  const initialNodes = React.useMemo<Node<PersonData>[]>(
    () =>
      scoped.map((r) => {
        const pos = r.x != null && r.y != null ? { x: r.x, y: r.y } : (computed.get(r.id) ?? { x: 0, y: 0 })
        return {
          id: String(r.id),
          type: 'person',
          position: pos,
          data: { label: r.name, title: r.title, department: r.department, photoUrl: r.photoUrl, isRoot: rootIds.includes(r.id) },
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, businessGroupId],
  )

  const initialEdges = React.useMemo(
    () =>
      scoped
        .filter((r) => r.reportsToId != null && scoped.some((s) => s.id === r.reportsToId))
        .map((r) => ({
          id: `e${r.reportsToId}-${r.id}`,
          source: String(r.reportsToId),
          target: String(r.id),
          type: 'smoothstep',
          style: { stroke: 'var(--color-line-strong, #c7ccd6)', strokeWidth: 1.5 },
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, businessGroupId],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges] = useEdgesState(initialEdges)
  const [guide, setGuide] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const { zoom } = useViewport()

  React.useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    // Only re-seed when the scope itself changes — onNodesChange owns
    // position updates after that, so re-running this on every render
    // would snap a card back mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessGroupId])

  const handleNodesChange = (changes: NodeChange<Node<PersonData>>[]) => {
    let nextGuideX: number | null = null
    let nextGuideY: number | null = null

    for (const change of changes) {
      if (change.type !== 'position' || !change.position) continue

      if (change.dragging) {
        // Magnetize while the card is moving — snapped against wherever
        // every other card currently sits, not the pre-drag layout, so a
        // card dragged near a card that was itself just moved still lines
        // up with it.
        const { position, guideX, guideY } = magnetize(change.id, change.position, nodes, zoom)
        change.position = position
        if (guideX != null) nextGuideX = guideX
        if (guideY != null) nextGuideY = guideY
      } else {
        void saveOrgChartPosition(Number(change.id), change.position.x, change.position.y)
      }
    }

    setGuide({ x: nextGuideX, y: nextGuideY })
    onNodesChange(changes)
  }

  if (scoped.length === 0) {
    return (
      <div className="h-[32rem]">
        <EmptyState icon={Users} title="Nobody here yet" description="No active employees are assigned to this company." />
      </div>
    )
  }

  return (
    <div className="relative h-[42rem] overflow-hidden rounded-xl border border-line">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        nodeTypes={NODE_TYPES}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <GuideLines guideX={guide.x} guideY={guide.y} />
    </div>
  )
}

export function OrgChartCanvas({
  rows,
  businessGroupId,
  businessGroupName,
}: {
  rows: OrgChartEmployee[]
  businessGroupId: number | null
  businessGroupName: string | null
}) {
  const [companyName, setCompanyName] = React.useState<string | null>(null)

  React.useEffect(() => {
    void getCompanySettings()
      .then((s) => setCompanyName(s.trade_name || s.legal_name))
      .catch(() => setCompanyName(null))
  }, [])

  if (businessGroupId == null) {
    return (
      <div className="h-64">
        <EmptyState icon={Users} title="No company selected" description="Choose a company above to see its chart." />
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-[11px] text-ink-3">
        Drag any card to arrange it — the position is remembered per person. The connecting lines follow each
        employee's reporting line on their 201 file; dragging a card never changes who they report to.
      </p>
      <ReactFlowProvider>
        <Canvas key={businessGroupId} rows={rows} businessGroupId={businessGroupId} />
      </ReactFlowProvider>
      {companyName && businessGroupName && (
        <p className="mt-2 text-[10px] text-ink-3">{businessGroupName} · {companyName}</p>
      )}
    </div>
  )
}
