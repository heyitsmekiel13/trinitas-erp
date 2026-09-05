import * as React from 'react'
import { Fuel } from 'lucide-react'
import { useCompany } from '@/lib/company'
import { liveApi } from '@/lib/adminApi'
import { EmptyState } from '@/components/ui/feedback'
import { FuelRequestForm } from './FuelRequestForm'

/**
 * Raising a fuel request, in its own tab.
 *
 * It opens outside the ERP shell for the same reason the booking page does: a
 * map wants the width, and a sidebar of eight departments is not what somebody
 * planning a delivery needs on screen. It is still behind the sign-in — this is
 * an internal document, unlike the client booking page.
 *
 * The route is priced by the server as the pins move. Nothing about the
 * distance, the duration or the litres is typed by the person asking for the
 * fuel, which is the entire point: a request where the requester states the
 * distance is a request that cannot be checked.
 */
export function FuelRequestPage() {
  const company = useCompany()

  /*
   * `?edit=12` amends an existing request in the same tab the queue opened.
   * Read from the URL rather than passed as a prop because this page is a
   * route, and a link is the only way the list can reach it.
   */
  const editId = React.useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('edit')
    const id = raw ? Number(raw) : NaN
    return Number.isFinite(id) && id > 0 ? id : null
  }, [])

  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-surface" data-print="hide">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grad-brand flex size-10 items-center justify-center rounded-xl text-white">
              <Fuel className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] leading-tight font-semibold text-ink">
                {editId ? 'Amend Fuel & Trip Request' : 'Fuel & Trip Request'}
              </p>
              <p className="truncate text-[11px] text-ink-3">{company.name} · Maintenance</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {liveApi() ? (
          <FuelRequestForm editId={editId} />
        ) : (
          <div className="card">
            <EmptyState
              icon={Fuel}
              title="Fuel requests need the live API"
              description="The route, the distance and the suggested litres are all worked out on the server."
            />
          </div>
        )}
      </main>
    </div>
  )
}
