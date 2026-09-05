import * as React from 'react'
import JsBarcode from 'jsbarcode'
import { escapeHtml, printRegion } from '@/lib/export'

/**
 * A real, scannable barcode — not the QR code standing in for one elsewhere
 * in this module.
 *
 * Code128 encodes the SKU's own characters (letters, digits, dashes)
 * directly, with no digits-only restriction to work around, and reads on
 * both classic laser scanners and camera-based ones — the widest hardware
 * compatibility for a warehouse floor. Rendered to an inline SVG rather than
 * a raster image, so it stays crisp printed at any size.
 */
export function Code128Barcode({ value, height = 60 }: { value: string; height?: number }) {
  const ref = React.useRef<SVGSVGElement>(null)

  React.useEffect(() => {
    if (!ref.current) return
    if (!value) {
      ref.current.replaceChildren()
      return
    }
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        height,
        displayValue: true,
        fontSize: 13,
        margin: 8,
      })
    } catch {
      // A value Code128 cannot encode (empty after trimming, unsupported
      // characters) leaves the SVG blank rather than crashing the panel
      // it sits in.
      ref.current.replaceChildren()
    }
  }, [value, height])

  if (!value) {
    return <p className="py-4 text-center text-[12px] text-ink-3">No barcode set.</p>
  }

  return (
    <div className="flex justify-center overflow-x-auto">
      <svg ref={ref} />
    </div>
  )
}

/**
 * Renders straight to an off-screen canvas rather than the SVG the live
 * detail panel uses. A print sheet is built from freshly created,
 * never-mounted DOM nodes (see `printItemBarcodeSheet` below) — an SVG
 * generated there has no layout to measure, so `printRegion`'s own copy of
 * each chart's rendered size would find only zeroes. A canvas carries its
 * width and height as real attributes regardless of whether it was ever on
 * screen, so turning it into a data-URI `<img>` sidesteps that entirely —
 * the same trick the QR label sheet already relies on.
 */
function barcodeDataUrl(value: string, height = 60): string {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, value, {
    format: 'CODE128',
    height,
    displayValue: true,
    fontSize: 13,
    margin: 8,
  })
  return canvas.toDataURL('image/png')
}

type TaggableItem = { sku: string; barcode?: string | null; name: string }

/**
 * One item, one tag — sized for a small thermal label. This is the "I'm
 * standing at the shelf with this one item, give me a sticker for it" path;
 * `printItemBarcodeSheet` below is the "tag a whole batch at once" one.
 */
export function printItemBarcodeLabel(item: TaggableItem) {
  const value = item.barcode || item.sku
  const card = document.createElement('div')
  card.style.cssText =
    'margin:10mm auto;width:64mm;border:2px solid #000;border-radius:8px;padding:10px;text-align:center'
  card.innerHTML = `
    <p style="font-size:12px;font-weight:600;margin:0 0 6px">${escapeHtml(item.name)}</p>
    <img src="${barcodeDataUrl(value)}" style="width:100%;display:block" />
  `
  printRegion(card, { title: `Barcode — ${value}`, bare: true })
}

/**
 * Every item passed in, printed as one sheet of tags — for tagging a batch
 * of stock in one pass rather than one label at a time. Built off-screen
 * rather than from the mounted grid, the same way the QR label sheet is:
 * each barcode is already a finished image by the time it prints, so
 * there is nothing left to load or lay out.
 */
export function printItemBarcodeSheet(items: TaggableItem[], sheetTitle: string) {
  const container = document.createElement('div')
  container.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10mm'

  for (const item of items) {
    const value = item.barcode || item.sku
    const card = document.createElement('div')
    card.style.cssText =
      'border:2px solid #000;border-radius:8px;padding:10px;text-align:center;break-inside:avoid'
    card.innerHTML = `
      <p style="font-size:11px;font-weight:600;margin:0">${escapeHtml(item.name)}</p>
      <img src="${barcodeDataUrl(value, 45)}" style="width:100%;display:block;margin-top:4px" />
    `
    container.appendChild(card)
  }

  printRegion(container, { title: sheetTitle, bare: true })
}
