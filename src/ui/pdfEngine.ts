import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Raster } from '../lib/pdfExport'
import { LINE_HEIGHT } from '../lib/pdfModel'
import { t } from '../lib/i18n'

/** pdf.js is large: load it (and its worker) only when a PDF is first opened. */
type PdfJs = typeof import('pdfjs-dist')
let loader: Promise<PdfJs> | undefined

function pdfjs(): Promise<PdfJs> {
  loader ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })()
  return loader
}

export type { PDFDocumentProxy, RenderTask }

/** Parse a PDF for viewing. Hands pdf.js its own copy: the worker detaches the buffer it receives. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await pdfjs()
  try {
    return await lib.getDocument({ data: bytes.slice() }).promise
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error(t('pdf.err.password'))
    throw new Error(t('pdf.err.load', { msg: error instanceof Error ? error.message : String(error) }))
  }
}

/** Free a document's worker and memory. */
export const releasePdf = (doc: PDFDocumentProxy): void => void doc.loadingTask.destroy()

/** Page size in CSS pixels at `scale`, including the page's built-in rotation. */
export async function pageSize(doc: PDFDocumentProxy, index: number, scale: number): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(index + 1)
  const view = page.getViewport({ scale })
  return { width: view.width, height: view.height }
}

/** Draw a page into `canvas` (sharp on high-DPI screens). Cancel the task to abandon a stale render. */
export async function startRender(doc: PDFDocumentProxy, index: number, scale: number, canvas: HTMLCanvasElement): Promise<RenderTask> {
  const page = await doc.getPage(index + 1)
  const view = page.getViewport({ scale })
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(view.width * ratio)
  canvas.height = Math.floor(view.height * ratio)
  canvas.style.width = `${view.width}px`
  canvas.style.height = `${view.height}px`
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')
  return page.render({
    canvas,
    canvasContext: context,
    viewport: view,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  })
}

/** Plain text of one source page, in reading order as pdf.js reports it. */
export async function extractPageText(doc: PDFDocumentProxy, index: number): Promise<string> {
  const page = await doc.getPage(index + 1)
  const content = await page.getTextContent()
  let text = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text.trim()
}

const canvasBlob = (canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), mime, quality),
  )

const blobBytes = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer())

const RASTER_FONT = "'Segoe UI', 'Noto Sans Thai', Tahoma, sans-serif"
const RASTER_PADDING_PX = 2

/** Text → PNG, for characters the PDF's built-in fonts lack (Thai and other scripts). */
export async function rasterizeText(text: string, fontPx: number, color: string): Promise<Raster> {
  const lines = text.split('\n')
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('Canvas is not available')
  probe.font = `${fontPx}px ${RASTER_FONT}`
  const textWidth = Math.max(1, ...lines.map((line) => probe.measureText(line).width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(textWidth) + RASTER_PADDING_PX * 2
  canvas.height = Math.ceil(lines.length * LINE_HEIGHT * fontPx)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.font = `${fontPx}px ${RASTER_FONT}`
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  lines.forEach((line, i) => ctx.fillText(line, RASTER_PADDING_PX, (i * LINE_HEIGHT + 0.9) * fontPx))
  return { bytes: await blobBytes(await canvasBlob(canvas, 'image/png')), width: canvas.width, height: canvas.height }
}

/** First page of a (small, freshly built) PDF as an image file's bytes. */
export async function renderFirstPageImage(pdf: Uint8Array, mime: 'image/png' | 'image/jpeg', scale: number): Promise<Uint8Array> {
  const doc = await loadPdf(pdf)
  try {
    const page = document.createElement('canvas')
    await (await startRender(doc, 0, scale, page)).promise
    // A fresh white canvas underneath: JPEG has no transparency.
    const flat = document.createElement('canvas')
    flat.width = page.width
    flat.height = page.height
    const ctx = flat.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, flat.width, flat.height)
    ctx.drawImage(page, 0, 0)
    return await blobBytes(await canvasBlob(flat, mime, 0.92))
  } finally {
    releasePdf(doc)
  }
}
