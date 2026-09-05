import { company } from './company'
import { fmtDateTime, isoDate } from './format'

/**
 * Export engine.
 *
 * Two jobs:
 *  1. Data out — CSV / Excel-readable, straight from what the table shows.
 *  2. Paper out — a print pipeline that renders any region of the app onto
 *     A4 through the print stylesheet in `theme.css`. The browser's own
 *     "Save as PDF" is the PDF writer, which means perfect vector text,
 *     selectable content, and zero megabytes of PDF library in the bundle.
 */

/* -------------------------------------------------------------------------- */
/* Preview channel                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Nothing prints or downloads without being seen first.
 *
 * The export functions below build their output as an HTML string and hand it
 * to whichever component is listening — `ExportPreview`, mounted once at the
 * app root. That keeps every existing call site unchanged: `printRegion(...)`
 * still reads like "print this", it just shows the page before committing to
 * paper. Callers that genuinely want no preview use the `*Now` variants.
 */
export type PreviewRequest = {
  kind: 'paper' | 'excel' | 'csv'
  title: string
  subtitle?: string
  /** Fully-formed document: a letterheaded sheet, a workbook, or CSV text. */
  html: string
  /** Base filename for the download, without extension or date. */
  filename: string
  /** Re-runs the print pipeline when the reader accepts the preview. */
  print?: () => void
  /** Writes the file when the reader accepts the preview. */
  save?: () => void
}

type PreviewListener = (request: PreviewRequest) => void

let previewListener: PreviewListener | null = null

/** Registers the preview surface. Returns an unsubscribe function. */
export function onPreview(listener: PreviewListener) {
  previewListener = listener
  return () => {
    if (previewListener === listener) previewListener = null
  }
}

/**
 * Hands a document to the preview surface. With nothing listening the export
 * proceeds directly, so exports never silently do nothing.
 */
function openPreview(request: PreviewRequest) {
  if (previewListener) previewListener(request)
  else (request.print ?? request.save)?.()
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

export type ExportColumn<T> = {
  header: string
  value: (row: T) => string | number | null | undefined
}

function escapeCell(value: unknown): string {
  if (value == null) return ''
  const text = String(value)
  // Guard against CSV formula injection when the file is opened in Excel.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',')
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(',')).join('\r\n')
  return `${header}\r\n${body}`
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv<T>(name: string, columns: ExportColumn<T>[], rows: T[]) {
  const csv = toCsv(columns, rows)

  openPreview({
    kind: 'csv',
    title: name,
    subtitle: `${rows.length} row${rows.length === 1 ? '' : 's'} · ${columns.length} columns`,
    html: csv,
    filename: name,
    save: () => {
      // The BOM makes Excel read UTF-8 (and the ₱ sign) correctly.
      download(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }), `${name}-${isoDate(new Date())}.csv`)
    },
  })
}

/**
 * Excel-compatible export without an XLSX dependency: a single-sheet HTML
 * workbook, which Excel and LibreOffice both open natively with formatting.
 */
function excelHtml<T>(title: string, columns: ExportColumn<T>[], rows: T[]) {
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(String(c.value(row) ?? ''))}</td>`).join('')}</tr>`)
    .join('')

  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: Calibri, sans-serif; font-size: 11pt; }
  th { background: #E11D34; color: #fff; font-weight: 600; text-align: left; padding: 6px 10px; border: 1px solid #C2142B; }
  td { padding: 5px 10px; border: 1px solid #D9DDE3; }
  caption { text-align: left; font-size: 14pt; font-weight: 700; padding-bottom: 8px; }
</style></head><body>
<table><caption>${escapeHtml(title)} — ${escapeHtml(company().name)} — ${escapeHtml(fmtDateTime(new Date()))}</caption>
<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
}

/** Writes the prepared workbook to disk. */
export function downloadExcelHtml(name: string, html: string) {
  download(new Blob([html], { type: 'application/vnd.ms-excel' }), `${name}-${isoDate(new Date())}.xls`)
}

/**
 * Opens the workbook in the preview dialog first. Nothing reaches the disk
 * until the reader has looked at it and pressed Download.
 */
export function exportExcel<T>(name: string, title: string, columns: ExportColumn<T>[], rows: T[]) {
  openPreview({
    kind: 'excel',
    title,
    subtitle: `${rows.length} row${rows.length === 1 ? '' : 's'} · opens in Excel or LibreOffice`,
    html: excelHtml(title, columns, rows),
    filename: name,
    save: () => downloadExcelHtml(name, excelHtml(title, columns, rows)),
  })
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/* -------------------------------------------------------------------------- */
/* Print / PDF                                                                 */
/* -------------------------------------------------------------------------- */

const PRINT_ROOT_ID = 'trinitas-print-root'

function ensurePrintRoot() {
  let root = document.getElementById(PRINT_ROOT_ID)
  if (!root) {
    root = document.createElement('div')
    root.id = PRINT_ROOT_ID
    document.body.appendChild(root)
  }
  return root
}

// Injected once. Hides the live app during printing and reveals the clone.
function ensurePrintStyles() {
  if (document.getElementById('trinitas-print-style')) return
  const style = document.createElement('style')
  style.id = 'trinitas-print-style'
  style.textContent = `
    #${PRINT_ROOT_ID} { display: none; }
    @media print {
      body.trinitas-printing > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
      body.trinitas-printing #${PRINT_ROOT_ID} { display: block !important; }
    }
    .print-sheet { background: #fff; color: #000; }
    .print-letterhead {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
      border-bottom: 2px solid #E11D34; padding-bottom: 12px; margin-bottom: 18px;
    }
    .print-mark {
      width: 40px; height: 40px; border-radius: 10px; color: #fff; font-weight: 700;
      display: flex; align-items: center; justify-content: center; font-size: 17px;
      background: linear-gradient(135deg, #FF5C68 0%, #E11D34 48%, #9D1024 100%);
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .print-footer {
      border-top: 1px solid #D0D5DD; margin-top: 20px; padding-top: 8px;
      font-size: 9pt; color: #555; display: flex; justify-content: space-between; gap: 16px;
    }
    /* A screen table sized to scroll (Tailwind's min-w-[Nrem], set so a wide
       table reads comfortably on a monitor) has nothing to scroll on paper —
       it just runs past the page edge and the trailing columns are cut off
       silently, which is exactly what happened to a DTR's Status column.
       Print has no viewport to scroll, so the table has to shrink to fit
       the sheet instead; the min-width is what was stopping it. */
    .print-sheet table { width: 100% !important; min-width: 0 !important; table-layout: auto; font-size: 8pt; }
    .print-sheet th, .print-sheet td { padding: 3px 4px !important; overflow-wrap: anywhere; }
  `
  document.head.appendChild(style)
}

export type PrintMeta = {
  title: string
  subtitle?: string
  /** Filter context — "what this report is scoped to". */
  criteria?: { label: string; value: string }[]
  preparedBy?: string
  confidential?: boolean
  /**
   * Skips the generic letterhead and footer this sheet would otherwise get.
   *
   * For a region that is already a complete printable document in its own
   * right — a purchase order form, a service report — that already carries
   * its own company header and reference block. Wrapping it in a second,
   * generic one is how a one-page form becomes three: the export letterhead
   * and title sit on their own page, the form's own letterhead and body spill
   * onto the next, and the footer lands on a third.
   */
  bare?: boolean
}

function letterhead(meta: PrintMeta) {
  const criteria = meta.criteria?.length
    ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:9.5pt;color:#333">
         ${meta.criteria
           .map((c) => `<span><strong style="color:#555;font-weight:600">${escapeHtml(c.label)}:</strong> ${escapeHtml(c.value)}</span>`)
           .join('')}
       </div>`
    : ''

  const profile = company()

  // An uploaded logo replaces the generated mark. Everything else on the
  // letterhead comes from Admin → System Settings → Company.
  const mark = profile.logoUrl
    ? `<img src="${escapeHtml(profile.logoUrl)}" alt="" style="height:40px;width:auto;max-width:150px;object-fit:contain">`
    : '<div class="print-mark">T</div>'

  const details = [
    profile.address ? `<div style="font-size:8.5pt;color:#555">${escapeHtml(profile.address)}</div>` : '',
    profile.tin ? `<div style="font-size:8.5pt;color:#555">TIN ${escapeHtml(profile.tin)}</div>` : '',
  ].join('')

  return `<header class="print-letterhead">
    <div>
      <div style="display:flex;align-items:center;gap:10px">
        ${mark}
        <div>
          <div style="font-size:13pt;font-weight:700;letter-spacing:-0.01em">${escapeHtml(profile.legalName || profile.name)}</div>
          ${details}
        </div>
      </div>
      <h1 style="margin:14px 0 0;font-size:16pt;font-weight:700;letter-spacing:-0.02em">${escapeHtml(meta.title)}</h1>
      ${meta.subtitle ? `<p style="margin:3px 0 0;font-size:10pt;color:#444">${escapeHtml(meta.subtitle)}</p>` : ''}
      ${criteria}
    </div>
    <div style="text-align:right;font-size:8.5pt;color:#555;white-space:nowrap">
      <div><strong style="color:#000">Generated</strong></div>
      <div>${escapeHtml(fmtDateTime(new Date()))}</div>
      ${meta.preparedBy ? `<div style="margin-top:6px"><strong style="color:#000">Prepared by</strong></div><div>${escapeHtml(meta.preparedBy)}</div>` : ''}
      ${meta.confidential ? `<div style="margin-top:8px;color:#C2142B;font-weight:700;letter-spacing:.06em">CONFIDENTIAL</div>` : ''}
    </div>
  </header>`
}

function footer(meta: PrintMeta) {
  return `<footer class="print-footer">
    <span>${escapeHtml(company().name)} · ${escapeHtml(meta.title)}</span>
    <span>System-generated by Trinitas ERP — no signature required unless countersigned.</span>
  </footer>`
}

/** The full letterheaded sheet, ready to preview or to print. */
function sheetHtml(inner: string, meta: PrintMeta) {
  if (meta.bare) return `<div class="print-sheet">${inner}</div>`

  return `<div class="print-sheet">${letterhead(meta)}<main>${inner}</main>${footer(meta)}</div>`
}

/** Runs the browser print dialog against a detached clone, then cleans up. */
function printHtmlNow(sheet: string) {
  ensurePrintStyles()
  const root = ensurePrintRoot()
  root.innerHTML = sheet
  document.body.classList.add('trinitas-printing')

  const cleanup = () => {
    document.body.classList.remove('trinitas-printing')
    root.innerHTML = ''
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)

  // Let layout settle (charts resize on reflow) before opening the dialog.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
}

/** Shows the sheet in the preview dialog; printing happens on acceptance. */
function printHtml(inner: string, meta: PrintMeta) {
  const sheet = sheetHtml(inner, meta)

  openPreview({
    kind: 'paper',
    title: meta.title,
    subtitle: meta.subtitle,
    html: sheet,
    filename: meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    print: () => printHtmlNow(sheet),
  })
}

/**
 * The app's own stylesheets, as tags that can be dropped into the preview
 * iframe.
 *
 * "Export as-is" clones live DOM that is styled entirely by Tailwind utility
 * classes. Printing from the app document keeps those rules in scope; an
 * iframe does not, and without this the preview would show an honest-looking
 * page that is nothing like what prints. Vite serves CSS as inline <style> in
 * development and as <link> in a build, so both are carried across.
 */
export function collectAppStyles(): string {
  const parts: string[] = []

  document.querySelectorAll<HTMLStyleElement>('style').forEach((style) => {
    // Skip the print-visibility shim; it hides everything inside the iframe.
    if (style.id === 'trinitas-print-style') return
    parts.push(`<style>${style.textContent ?? ''}</style>`)
  })

  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((link) => {
    // `link.href` is already absolute, which matters inside about:srcdoc.
    parts.push(`<link rel="stylesheet" href="${escapeHtml(link.href)}">`)
  })

  return parts.join('')
}

/** Overrides layered on top of the app CSS to make the sheet read as paper. */
export const PREVIEW_STYLES = `
  html, body { margin: 0; background: #fff; }
  .print-sheet { padding: 16mm 14mm; background: #fff; color: #000; }
  .print-letterhead {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
    border-bottom: 2px solid #E11D34; padding-bottom: 12px; margin-bottom: 18px;
  }
  .print-mark {
    width: 40px; height: 40px; border-radius: 10px; color: #fff; font-weight: 700;
    display: flex; align-items: center; justify-content: center; font-size: 17px;
    background: linear-gradient(135deg, #FF5C68 0%, #E11D34 48%, #9D1024 100%);
  }
  .print-footer {
    border-top: 1px solid #D0D5DD; margin-top: 20px; padding-top: 8px;
    font-size: 9pt; color: #555; display: flex; justify-content: space-between; gap: 16px;
  }
  .print-sheet table { width: 100% !important; min-width: 0 !important; table-layout: auto; font-size: 8pt; }
  .print-sheet th, .print-sheet td { padding: 3px 4px !important; overflow-wrap: anywhere; }
  img, svg { max-width: 100%; }
`

/**
 * "Export as-is" — prints a live region of the app (a dashboard, a detail
 * panel) onto letterheaded A4 exactly as it appears on screen.
 */
export function printRegion(element: HTMLElement | null, meta: PrintMeta) {
  if (!element) return
  const clone = element.cloneNode(true) as HTMLElement

  // Interactive chrome has no meaning on paper.
  clone.querySelectorAll('[data-print="hide"]').forEach((el) => el.remove())
  clone.querySelectorAll('button, input, select').forEach((el) => {
    if (!el.closest('table')) el.remove()
  })

  // Copy computed sizes onto cloned SVG charts, which otherwise collapse to
  // zero height once detached from their ResponsiveContainer.
  const liveSvgs = element.querySelectorAll('svg')
  clone.querySelectorAll('svg').forEach((svg, i) => {
    const live = liveSvgs[i]
    if (!live) return
    const box = live.getBoundingClientRect()
    svg.setAttribute('width', String(Math.round(box.width)))
    svg.setAttribute('height', String(Math.round(box.height)))
    svg.style.width = `${Math.round(box.width)}px`
    svg.style.height = `${Math.round(box.height)}px`
  })

  printHtml(clone.outerHTML, meta)
}

/**
 * A region of the app as a downloaded PNG — for the one export "print" does
 * not cover: something meant to be attached, messaged or kept as an image
 * rather than a paper document. Everything else here still goes through the
 * browser's own print-to-PDF (see the module doc above for why); this is the
 * one case that genuinely has no equivalent without a rendering step.
 */
export async function downloadRegionAsPng(element: HTMLElement | null, filename: string) {
  if (!element) return

  const { toPng } = await import('html-to-image')
  const dataUrl = await toPng(element, {
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--surface') || '#ffffff',
    filter: (node) => !(node instanceof HTMLElement && node.dataset?.print === 'hide'),
    pixelRatio: 2,
  })

  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Builds a report from structured sections rather than from the screen. */
export type ReportSection =
  | { kind: 'summary'; title: string; items: { label: string; value: string; note?: string }[] }
  | { kind: 'table'; title: string; columns: string[]; rows: (string | number)[][]; total?: (string | number)[] }
  | { kind: 'element'; title: string; element: HTMLElement | null }
  | { kind: 'text'; title: string; body: string }
  | { kind: 'pagebreak' }

export function printReport(sections: ReportSection[], meta: PrintMeta) {
  const html = sections
    .map((section) => {
      if (section.kind === 'pagebreak') return '<div style="break-before:page"></div>'

      const heading = `<h2 style="margin:18px 0 8px;font-size:11.5pt;font-weight:700;border-left:3px solid #E11D34;padding-left:8px;-webkit-print-color-adjust:exact;print-color-adjust:exact">${escapeHtml(
        section.title,
      )}</h2>`

      if (section.kind === 'summary') {
        const cells = section.items.map(
          (i) => `<td style="border:1px solid #D0D5DD;padding:8px 10px;vertical-align:top">
              <div style="font-size:8pt;color:#555;text-transform:uppercase;letter-spacing:.05em">${escapeHtml(i.label)}</div>
              <div style="font-size:13pt;font-weight:700;margin-top:3px">${escapeHtml(i.value)}</div>
              ${i.note ? `<div style="font-size:8pt;color:#555;margin-top:2px">${escapeHtml(i.note)}</div>` : ''}
            </td>`,
        )

        // Four KPI cells per row keeps each readable at A4 width; the last
        // row is padded so the fixed layout stays square.
        const perRow = 4
        const rows: string[] = []
        for (let i = 0; i < cells.length; i += perRow) {
          const chunk = cells.slice(i, i + perRow)
          while (chunk.length < perRow) chunk.push('<td style="border:1px solid #D0D5DD"></td>')
          rows.push(`<tr>${chunk.join('')}</tr>`)
        }
        return `${heading}<table style="width:100%;border-collapse:collapse;table-layout:fixed">${rows.join('')}</table>`
      }

      if (section.kind === 'table') {
        const head = section.columns.map((c) => `<th style="border:1px solid #C2142B;background:#E11D34;color:#fff;padding:6px 8px;text-align:left;font-size:9pt;-webkit-print-color-adjust:exact;print-color-adjust:exact">${escapeHtml(c)}</th>`).join('')
        const body = section.rows
          .map(
            (r, ri) =>
              `<tr style="background:${ri % 2 ? '#F7F8FA' : '#fff'};-webkit-print-color-adjust:exact;print-color-adjust:exact">${r
                .map((cell) => `<td style="border:1px solid #D0D5DD;padding:5px 8px;font-size:9pt">${escapeHtml(String(cell))}</td>`)
                .join('')}</tr>`,
          )
          .join('')
        const total = section.total
          ? `<tr>${section.total.map((cell) => `<td style="border:1px solid #98A2B3;padding:6px 8px;font-size:9pt;font-weight:700;background:#EEF0F4">${escapeHtml(String(cell))}</td>`).join('')}</tr>`
          : ''
        return `${heading}<table style="width:100%;border-collapse:collapse">${`<thead><tr>${head}</tr></thead>`}<tbody>${body}${total}</tbody></table>`
      }

      if (section.kind === 'element') {
        if (!section.element) return ''
        const clone = section.element.cloneNode(true) as HTMLElement
        clone.querySelectorAll('[data-print="hide"]').forEach((el) => el.remove())
        const liveSvgs = section.element.querySelectorAll('svg')
        clone.querySelectorAll('svg').forEach((svg, i) => {
          const box = liveSvgs[i]?.getBoundingClientRect()
          if (!box) return
          svg.setAttribute('width', String(Math.round(box.width)))
          svg.setAttribute('height', String(Math.round(box.height)))
        })
        return `${heading}<div style="break-inside:avoid">${clone.outerHTML}</div>`
      }

      return `${heading}<p style="font-size:10pt;line-height:1.55;color:#222;white-space:pre-wrap">${escapeHtml(section.body)}</p>`
    })
    .join('')

  printHtml(html, meta)
}
