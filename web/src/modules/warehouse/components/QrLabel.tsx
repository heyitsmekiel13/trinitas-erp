import * as React from 'react'
import QRCode from 'qrcode'
import { escapeHtml, printRegion } from '@/lib/export'

/**
 * A real, scannable label — not the decorative bar chart this replaced.
 *
 * Same library and call shape as the HR ID card's QR (`web/src/modules/hr/idCards.tsx`),
 * just encoding an item's barcode or a bin's code instead of a public profile
 * link. A QR rather than a linear barcode because the library was already in
 * the bundle for ID cards — one more dependency to draw the same rectangle of
 * bars would have been pure cost for a symbology no scanner here actually
 * requires.
 */

/** The single-record preview shown in a resource page's detail panel. */
export function QrLabel({
  value,
  title,
  subtitle,
  template = '50 × 30 mm thermal · 1 label per pack',
}: {
  value: string
  title: string
  subtitle?: string
  template?: string
}) {
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { margin: 1, width: 240 })
      .then((url) => alive && setDataUrl(url))
      .catch(() => alive && setDataUrl(null))
    return () => {
      alive = false
    }
  }, [value])

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-xs rounded-lg border-2 border-ink p-4 text-center">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {subtitle && <p className="mt-0.5 text-[11px] text-ink-3">{subtitle}</p>}
        <div className="mt-3 flex justify-center">
          {dataUrl ? (
            <img src={dataUrl} alt={value} className="size-28" />
          ) : (
            <div className="flex size-28 items-center justify-center text-[10px] text-ink-3">Generating…</div>
          )}
        </div>
        <p className="mt-1.5 font-mono text-[12px] tracking-[0.2em] text-ink">{value}</p>
      </div>
      <p className="text-center text-xs text-ink-3">Template: {template}</p>
    </div>
  )
}

/**
 * Every filtered row, printed as one sheet of scannable labels.
 *
 * Built off-screen rather than from a mounted grid: the QR images are data
 * URIs, so there is nothing left to load once the string exists, and a
 * detached node prints through the same `bare` pipeline as the Fuel Purchase
 * Order Form — one self-contained sheet, not a report wrapped in a second
 * letterhead.
 */
export async function printQrLabelSheet(
  rows: { value: string; title: string; subtitle?: string }[],
  sheetTitle: string,
) {
  const container = document.createElement('div')
  container.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10mm'

  for (const row of rows) {
    const qr = await QRCode.toDataURL(row.value, { margin: 1, width: 160 })
    const card = document.createElement('div')
    card.style.cssText =
      'border:2px solid #000;border-radius:8px;padding:10px;text-align:center;break-inside:avoid'
    card.innerHTML = `
      <p style="font-size:11px;font-weight:600;margin:0">${escapeHtml(row.title)}</p>
      ${row.subtitle ? `<p style="font-size:9px;color:#555;margin:2px 0 0">${escapeHtml(row.subtitle)}</p>` : ''}
      <img src="${qr}" style="width:96px;height:96px;margin:6px auto 0;display:block" />
      <p style="font-family:monospace;font-size:10px;letter-spacing:.14em;margin:4px 0 0">${escapeHtml(row.value)}</p>
    `
    container.appendChild(card)
  }

  printRegion(container, { title: sheetTitle, bare: true })
}
