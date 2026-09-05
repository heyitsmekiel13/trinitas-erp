import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  draftDamageNote,
  generateCountSheet,
  nextStage,
  stageIndex,
  tallyKey,
  type ConditionCheck,
  type CountArea,
  type CountCondition,
  type CountableItem,
  type CountableStock,
  type CountCycle,
  type CountSheet,
  type Dispatch,
  type DispatchStage,
  type ReceivingEntry,
} from '@/data/warehouse'

/**
 * The warehouse floor's working state.
 *
 * Counting, receiving and dispatch are all *sessions* — a person picks the
 * thing up, checks it, and puts a number against it, often over an hour and
 * across three screens. Holding that in component state would throw the shift's
 * work away on the first navigation, so it lives here and is persisted.
 *
 * When the Laravel endpoints land this store becomes a thin cache in front of
 * them: the actions keep their signatures and gain a `fetch` inside.
 */

export type CountSource = { stock: CountableStock[]; items: CountableItem[] }

type OpsState = {
  /** Count sheets keyed `warehouse|cycleId` — one sheet per site per cut-off. */
  sheets: Record<string, CountSheet>
  receipts: ReceivingEntry[]
  dispatches: Dispatch[]
  seeded: boolean

  /**
   * Fills the board and the dock the first time they are opened.
   *
   * The caller supplies the records, because where they come from depends on
   * the install: real pick lists from the API, or the preview generators when
   * there is no API to ask. Seeding demo shipments onto a live system would put
   * documents in front of a user that do not exist anywhere else.
   */
  seed: (payload: { receipts: ReceivingEntry[]; dispatches: Dispatch[] }) => void
  reset: (payload: { receipts: ReceivingEntry[]; dispatches: Dispatch[] }) => void

  /* ---- counting ---- */
  /**
   * `source` is the stock and item master to count against — the live API's
   * rows on a real install, the preview dataset otherwise. Passed in rather
   * than read here, so the sheet always counts what the system actually holds.
   */
  openSheet: (warehouse: string, cycle: CountCycle, source: CountSource) => CountSheet
  regenerate: (warehouse: string, cycle: CountCycle, source: CountSource) => void
  setTally: (sheetId: string, lineId: string, area: CountArea, condition: CountCondition, qty: number) => void
  /** The fast-scan path: one number is everything that was found, replacing whatever the detailed grid held rather than adding to it. */
  setQuantityFound: (sheetId: string, lineId: string, qty: number) => void
  setLineLocations: (sheetId: string, lineId: string, locations: string[]) => void
  setLineNote: (sheetId: string, lineId: string, note: string) => void
  /** Signs the line off for this cycle — this is what clears "needs recount". */
  confirmLine: (sheetId: string, lineId: string, cycleId: string, by: string) => void
  reopenLine: (sheetId: string, lineId: string) => void
  matchSystem: (sheetId: string, lineId: string) => void
  postSheet: (sheetId: string, by: string) => void

  /* ---- receiving ---- */
  saveReceipt: (entry: ReceivingEntry) => void
  removeReceipt: (id: string) => void

  /* ---- dispatch ---- */
  advance: (
    id: string,
    payload: { by: string; note: string; checks: { sku: string; check: ConditionCheck }[] },
  ) => void
  setDispatchLocations: (id: string, locations: string[]) => void
  setDispatchDelivery: (id: string, patch: { driver?: string; vehicle?: string; promisedAt?: string }) => void
}

const editSheet = (state: OpsState, sheetId: string, edit: (sheet: CountSheet) => CountSheet) => {
  const sheet = state.sheets[sheetId]
  if (!sheet || sheet.postedAt) return state
  return { ...state, sheets: { ...state.sheets, [sheetId]: edit(sheet) } }
}

const editLine = (
  state: OpsState,
  sheetId: string,
  lineId: string,
  edit: (line: CountSheet['lines'][number]) => CountSheet['lines'][number],
) =>
  editSheet(state, sheetId, (sheet) => ({
    ...sheet,
    lines: sheet.lines.map((line) => (line.id === lineId ? edit(line) : line)),
  }))

export const useOps = create<OpsState>()(
  persist(
    (set, get) => ({
      sheets: {},
      receipts: [],
      dispatches: [],
      seeded: false,

      seed: (payload) => {
        if (get().seeded) return
        set({ receipts: payload.receipts, dispatches: payload.dispatches, seeded: true })
      },

      reset: (payload) => set({ sheets: {}, receipts: payload.receipts, dispatches: payload.dispatches, seeded: true }),

      /* ------------------------------ counting ----------------------------- */

      openSheet: (warehouse, cycle, source) => {
        const id = `${warehouse}|${cycle.id}`
        const existing = get().sheets[id]
        if (existing) return existing
        const sheet = generateCountSheet(warehouse, cycle, source)
        set((state) => ({ sheets: { ...state.sheets, [id]: sheet } }))
        return sheet
      },

      regenerate: (warehouse, cycle, source) => {
        const id = `${warehouse}|${cycle.id}`
        set((state) => ({ sheets: { ...state.sheets, [id]: generateCountSheet(warehouse, cycle, source) } }))
      },

      setTally: (sheetId, lineId, area, condition, qty) =>
        set((state) =>
          editLine(state, sheetId, lineId, (line) => ({
            ...line,
            tally: { ...line.tally, [tallyKey(area, condition)]: Math.max(0, Math.round(qty) || 0) },
          })),
        ),

      setQuantityFound: (sheetId, lineId, qty) =>
        set((state) =>
          editLine(state, sheetId, lineId, (line) => ({
            ...line,
            tally: { [tallyKey('Warehouse', 'Good')]: Math.max(0, Math.round(qty) || 0) },
          })),
        ),

      setLineLocations: (sheetId, lineId, locations) =>
        set((state) => editLine(state, sheetId, lineId, (line) => ({ ...line, locations }))),

      setLineNote: (sheetId, lineId, note) =>
        set((state) => editLine(state, sheetId, lineId, (line) => ({ ...line, note }))),

      confirmLine: (sheetId, lineId, cycleId, by) =>
        set((state) =>
          editLine(state, sheetId, lineId, (line) => ({
            ...line,
            countedCycleId: cycleId,
            countedBy: by,
            countedAt: new Date().toISOString(),
          })),
        ),

      reopenLine: (sheetId, lineId) =>
        set((state) =>
          editLine(state, sheetId, lineId, (line) => ({
            ...line,
            countedCycleId: '',
            countedBy: '',
            countedAt: null,
          })),
        ),

      // "It matches" is the commonest outcome and deserves one click rather
      // than typing the system figure back into the physical column.
      matchSystem: (sheetId, lineId) =>
        set((state) =>
          editLine(state, sheetId, lineId, (line) => ({
            ...line,
            tally: { [tallyKey('Warehouse', 'Good')]: line.systemCount },
          })),
        ),

      postSheet: (sheetId, by) =>
        set((state) =>
          editSheet(state, sheetId, (sheet) => ({ ...sheet, postedAt: new Date().toISOString(), postedBy: by })),
        ),

      /* ----------------------------- receiving ----------------------------- */

      saveReceipt: (entry) =>
        set((state) => {
          const notes = entry.notes.trim() ? entry.notes : draftDamageNote(entry.lines)
          const next = { ...entry, notes }
          const index = state.receipts.findIndex((r) => r.id === entry.id)
          const receipts = [...state.receipts]
          if (index >= 0) receipts[index] = next
          else receipts.unshift(next)
          return { receipts }
        }),

      removeReceipt: (id) => set((state) => ({ receipts: state.receipts.filter((r) => r.id !== id) })),

      /* ------------------------------ dispatch ----------------------------- */

      advance: (id, payload) =>
        set((state) => ({
          dispatches: state.dispatches.map((d) => {
            if (d.id !== id) return d
            const target = nextStage(d.stage)
            if (!target) return d
            const now = new Date().toISOString()

            return {
              ...d,
              stage: target,
              dispatchedAt: target === 'Out for Delivery' ? now : d.dispatchedAt,
              deliveredAt: target === 'Delivered' ? now : d.deliveredAt,
              lines: d.lines.map((line) => ({
                ...line,
                qtyPicked: stageIndex(target) >= stageIndex('Picking') ? line.qtyOrdered : line.qtyPicked,
                // Anything graded scrap at this hand-over never reaches the
                // customer, so the delivered figure is the ordered quantity
                // less what was pulled out of the load.
                qtyDelivered:
                  target === 'Delivered'
                    ? Math.max(
                        0,
                        line.qtyOrdered -
                          payload.checks
                            .filter((c) => c.sku === line.sku && c.check.disposition !== 'Put away')
                            .reduce((sum, c) => sum + c.check.qty, 0),
                      )
                    : line.qtyDelivered,
              })),
              history: [...d.history, { stage: target, at: now, by: payload.by, note: payload.note, checks: payload.checks }],
            }
          }),
        })),

      setDispatchLocations: (id, locations) =>
        set((state) => ({ dispatches: state.dispatches.map((d) => (d.id === id ? { ...d, locations } : d)) })),

      setDispatchDelivery: (id, patch) =>
        set((state) => ({ dispatches: state.dispatches.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
    }),
    {
      name: 'trinitas.warehouse.ops',
      // Bumped whenever a shape here changes, so a stale session is discarded
      // rather than half-read into fields that no longer exist.
      version: 1,
      migrate: () => ({ sheets: {}, receipts: [], dispatches: [], seeded: false }) as unknown as OpsState,
      partialize: (state) => ({
        sheets: state.sheets,
        receipts: state.receipts,
        dispatches: state.dispatches,
        seeded: state.seeded,
      }) as unknown as OpsState,
    },
  ),
)

/** Stage labels in the order the floor works through them. */
export const STAGE_HINT: Record<DispatchStage, string> = {
  Open: 'Released to the floor — nobody has touched it yet.',
  Picking: 'Being pulled from the racks against the pick list.',
  Packed: 'Boxed, labelled and checked against the order.',
  'Out for Delivery': 'On the truck and away.',
  Delivered: 'Signed for at the customer.',
  Completed: 'Paperwork closed and handed to Accounting.',
}
