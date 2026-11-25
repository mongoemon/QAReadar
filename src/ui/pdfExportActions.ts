import { downloadBytes, saveBinaryFile, saveTextFile, type FileKind } from '../lib/fileAccess'
import { t } from '../lib/i18n'
import type { PdfModel } from '../lib/pdfModel'
import { extractPageText, rasterizeText, renderFirstPageImage, type PDFDocumentProxy } from './pdfEngine'

/** Everything an export needs from the open document. */
export interface ExportInput {
  readonly sources: readonly Uint8Array[]
  readonly docs: readonly PDFDocumentProxy[]
  readonly model: PdfModel
  /** File name without extension. */
  readonly baseName: string
}

export const PDF_KIND: FileKind = { description: 'PDF', mime: 'application/pdf', extensions: ['pdf'] }
const PNG_KIND: FileKind = { description: 'PNG image', mime: 'image/png', extensions: ['png'] }
const JPEG_KIND: FileKind = { description: 'JPEG image', mime: 'image/jpeg', extensions: ['jpg'] }
const TEXT_KIND: FileKind = { description: 'Text', mime: 'text/plain', extensions: ['txt'] }
const MARKDOWN_KIND: FileKind = { description: 'Markdown', mime: 'text/markdown', extensions: ['md'] }

/** Image export resolution: CSS pixels per PDF point (2 = 144 dpi). */
const IMAGE_SCALE = 2

/** Sarabun (SIL OFL, Thai + Latin), inlined as a data URI so it also loads from file:// in the desktop app. */
async function loadThaiFont(): Promise<Uint8Array> {
  const { default: dataUri } = await import('../assets/fonts/Sarabun-Regular.ttf?inline')
  return new Uint8Array(await (await fetch(dataUri)).arrayBuffer())
}

/** The edited document as PDF bytes (all pages, or only the given positions). */
export async function buildEdited(input: ExportInput, only?: readonly number[]): Promise<Uint8Array> {
  // pdf-lib is only needed once something is saved or exported.
  const { buildPdf } = await import('../lib/pdfExport')
  return buildPdf(input.sources, input.model, { rasterize: rasterizeText, loadFont: loadThaiFont, only })
}

/** A copy of the edited document under a new name; null when the picker was cancelled. */
export async function exportPdfCopy(input: ExportInput): Promise<string | null> {
  const bytes = await buildEdited(input)
  const saved = await saveBinaryFile(`${input.baseName}-edited.pdf`, bytes, PDF_KIND, null, true)
  return saved?.name ?? null
}

const pageImageName = (input: ExportInput, at: number, ext: string): string =>
  `${input.baseName}-page${String(at + 1).padStart(String(input.model.pages.length).length, '0')}.${ext}`

async function pageImage(input: ExportInput, at: number, mime: 'image/png' | 'image/jpeg'): Promise<Uint8Array> {
  return renderFirstPageImage(await buildEdited(input, [at]), mime, IMAGE_SCALE)
}

export async function exportPageImage(input: ExportInput, at: number, jpeg: boolean): Promise<string | null> {
  const bytes = await pageImage(input, at, jpeg ? 'image/jpeg' : 'image/png')
  const saved = await saveBinaryFile(pageImageName(input, at, jpeg ? 'jpg' : 'png'), bytes, jpeg ? JPEG_KIND : PNG_KIND, null, true)
  return saved?.name ?? null
}

interface DirectoryHandleLike {
  getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }> }>
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

/**
 * Every page as a PNG: into a chosen folder where the browser allows it, otherwise as separate
 * downloads. Returns how many images were written (null = cancelled).
 */
export async function exportAllImages(input: ExportInput): Promise<number | null> {
  const pick = (window as unknown as { showDirectoryPicker?: (o: { mode: 'readwrite' }) => Promise<DirectoryHandleLike> }).showDirectoryPicker
  let folder: DirectoryHandleLike | null = null
  if (pick) {
    try {
      folder = await pick.call(window, { mode: 'readwrite' })
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  for (let at = 0; at < input.model.pages.length; at++) {
    const bytes = await pageImage(input, at, 'image/png')
    const fileName = pageImageName(input, at, 'png')
    if (folder) {
      const writable = await (await folder.getFileHandle(fileName, { create: true })).createWritable()
      await writable.write(bytes)
      await writable.close()
    } else {
      downloadBytes(fileName, bytes, PNG_KIND.mime)
    }
  }
  return input.model.pages.length
}

/** Page texts in the edited order. Added marks are not part of it: this is the PDF's own text. */
async function pageTexts(input: ExportInput): Promise<string[]> {
  return Promise.all(input.model.pages.map((page) => extractPageText(input.docs[page.source], page.index)))
}

/** Text or Markdown export; throws a readable error when the PDF has no text layer. */
export async function exportText(input: ExportInput, markdown: boolean): Promise<string | null> {
  const texts = await pageTexts(input)
  if (texts.every((text) => text === '')) throw new Error(t('pdf.noText'))
  const body = markdown
    ? texts.map((text, i) => `## Page ${i + 1}\n\n${text}`).join('\n\n')
    : texts.join('\n\n')
  const kind = markdown ? MARKDOWN_KIND : TEXT_KIND
  const saved = await saveTextFile({ name: `${input.baseName}.${kind.extensions[0]}`, text: `${body}\n`, handle: null }, kind, true)
  return saved?.name ?? null
}
