import * as React from 'react'
import { Download, Printer } from 'lucide-react'
import { PREVIEW_STYLES, collectAppStyles, onPreview, type PreviewRequest } from '@/lib/export'
import { Modal } from '@/components/ui/overlay'
import { Button } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'

/**
 * The export preview.
 *
 * Mounted once at the app root; every `printRegion`, `printReport` and
 * `exportExcel` call anywhere in the ERP surfaces here first. Nothing reaches
 * the printer or the disk until someone has looked at it — the point being
 * that you find the wrong period or the missing column on screen, not after
 * the paper is already in the tray.
 *
 * The document renders inside an iframe so the app's own stylesheet cannot
 * leak in and flatter it: what you see is what the file actually contains.
 */
export function ExportPreview() {
  const toast = useToast()
  const [request, setRequest] = React.useState<PreviewRequest | null>(null)

  React.useEffect(() => onPreview(setRequest), [])

  const close = () => setRequest(null)

  const paper = request?.kind === 'paper'
  const csv = request?.kind === 'csv'

  const srcDoc = React.useMemo(() => {
    if (!request || csv) return ''
    if (!paper) return request.html

    // The sheet is styled by the app's own utility classes, so the preview
    // has to carry them in. Forced to the light theme: paper is white.
    return `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
${collectAppStyles()}<style>${PREVIEW_STYLES}</style></head><body>${request.html}</body></html>`
  }, [request, paper, csv])

  return (
    <Modal
      open={request != null}
      onClose={close}
      size="2xl"
      title={request ? `Preview — ${request.title}` : ''}
      description={
        request?.subtitle ??
        (paper ? 'This is exactly how the page will print.' : 'This is exactly what the file will contain.')
      }
      bodyClassName="bg-surface-2 p-4"
      footer={
        <>
          <span className="mr-auto hidden text-[11px] text-ink-3 sm:block">
            {paper
              ? 'Choose “Save as PDF” in the print dialog to keep a copy.'
              : csv
                ? 'Downloads as a .csv file.'
                : 'Downloads as a .xls workbook.'}
          </span>
          <Button variant="secondary" size="sm" onClick={close}>
            Back
          </Button>
          {paper ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const print = request?.print
                close()
                // Let the dialog unmount before the print pipeline swaps the
                // page out, or the overlay ends up on the printed sheet.
                if (print) requestAnimationFrame(() => print())
              }}
            >
              <Printer className="size-3.5" />
              Print / Save as PDF
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                request?.save?.()
                toast({ tone: 'success', title: 'Download started' })
                close()
              }}
            >
              <Download className="size-3.5" />
              Download
            </Button>
          )}
        </>
      }
    >
      {csv ? (
        <pre className="max-h-[62dvh] overflow-auto rounded-lg bg-surface p-4 font-mono text-[11px] leading-relaxed whitespace-pre text-ink-2 ring-1 ring-line">
          {request?.html}
        </pre>
      ) : (
        <div className="mx-auto w-full max-w-[210mm] overflow-hidden rounded-lg bg-white shadow-[var(--shadow-pop)] ring-1 ring-black/10">
          <iframe
            // Remounting per document avoids a stale first paint when the
            // reader exports twice in a row.
            key={request?.title ?? 'empty'}
            title="Export preview"
            srcDoc={srcDoc}
            sandbox=""
            className="h-[62dvh] w-full border-0 bg-white"
          />
        </div>
      )}
    </Modal>
  )
}
