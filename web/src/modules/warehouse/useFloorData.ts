import * as React from 'react'
import { useResource } from '@/lib/api'
import { liveApi } from '@/lib/adminApi'
import { dataset } from '@/data/dataset'
import {
  buildDispatches,
  buildDispatchesFromOutbound,
  buildReceivingEntries,
  type CustomerLike,
  type OutboundLike,
  type SiteLike,
} from '@/data/warehouse'
import { useOps } from './ops'

/**
 * Seeds the dispatch board and the dock from whichever source is real.
 *
 * On a live install the board is built from the pick lists the API already
 * holds, and the dock starts empty — a receiving entry is something a person
 * creates when a truck arrives, so inventing a backlog of them would put
 * documents in front of the user that exist nowhere else. On preview data both
 * come from the generators, because there the whole point is having something
 * to look at.
 *
 * Seeding runs once; after that the store is the working copy.
 */
export function useSeedFloor() {
  const ops = useOps()
  const seeded = useOps((s) => s.seeded)
  const live = liveApi()

  const outboundQuery = useResource<OutboundLike[]>('warehouse/outbound', () => [], { enabled: live })
  const sitesQuery = useResource<SiteLike[]>('warehouse/locations', () => dataset().sites)
  const customersQuery = useResource<CustomerLike[]>('sales/customers', () => [], { enabled: live })

  React.useEffect(() => {
    if (seeded) return

    if (!live) {
      ops.seed({ receipts: buildReceivingEntries(), dispatches: buildDispatches() })
      return
    }

    // Every lookup has to have settled first. Seeding on the pick lists alone
    // would bake in empty customer and site rows — the cards would come out
    // with no city and no coordinates, and the board is seeded only once.
    const settled = [outboundQuery, sitesQuery, customersQuery].every((q) => !q.isPending)
    if (!settled) return

    const outbound = outboundQuery.data ?? []
    if (!outbound.length) return

    ops.seed({
      receipts: [],
      dispatches: buildDispatchesFromOutbound(outbound, sitesQuery.data ?? [], customersQuery.data ?? []),
    })
  }, [seeded, live, outboundQuery, sitesQuery, customersQuery, ops])
}

/** Re-seeds from source, discarding the working copy. */
export function useResetFloor() {
  const ops = useOps()
  const live = liveApi()

  const { data: outbound = [] } = useResource<OutboundLike[]>('warehouse/outbound', () => [], { enabled: live })
  const { data: sites = [] } = useResource<SiteLike[]>('warehouse/locations', () => dataset().sites)
  const { data: customers = [] } = useResource<CustomerLike[]>('sales/customers', () => [], { enabled: live })

  return React.useCallback(() => {
    if (!live) {
      ops.reset({ receipts: buildReceivingEntries(), dispatches: buildDispatches() })
      return
    }
    ops.reset({ receipts: [], dispatches: buildDispatchesFromOutbound(outbound, sites, customers) })
  }, [live, outbound, sites, customers, ops])
}
