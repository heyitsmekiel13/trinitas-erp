import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { afterSalesData, summarise, responseTimes, type AfterSalesData } from '@/data/afterSales'

/**
 * The imported After-Sales history.
 *
 * One fetch for the whole module — every page reads the same records, and
 * splitting them across four requests would only mean four chances to
 * disagree. React Query keeps it for the session.
 */
export function useAfterSales() {
  const query = useQuery<AfterSalesData>({
    queryKey: ['after-sales'],
    queryFn: afterSalesData,
    staleTime: Infinity,
  })

  const jobs = query.data?.jobs ?? []
  const requests = query.data?.requests ?? []

  const summary = React.useMemo(() => summarise(jobs), [jobs])
  const response = React.useMemo(() => responseTimes(requests, jobs), [requests, jobs])

  return { ...query, jobs, requests, summary, response }
}
