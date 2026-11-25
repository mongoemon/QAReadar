import fontkit from '@pdf-lib/fontkit'
import { degrees, LineCapStyle, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { LINE_HEIGHT, type Annotation, type BoxAnnotation, type PdfModel, type PenAnnotation, type TextAnnotation } from './pdfModel'

/** A page box in PDF user space (bottom-left origin), as pdf-lib reports it. */
export interface PageBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type BaseRotation = 0 | 90 | 180 | 270

export interface Raster {
  /** PNG bytes. */
  readonly bytes: Uint8Array
  readonly width: number
  readonly height: number
}

/** Draws text into a PNG (used for characters the built-in PDF fonts cannot show, e.g. Thai). */
export type TextRasterizer = (text: string, fontPx: number, color: string) => Promise<Raster>

/** Baseline offset from the top of the first line, as a multiple of the font size. */
const BASELINE = 0.9
const RASTER_FONT_PX = 64
const HIGHLIGHT_OPACITY = 0.35
const RECT_BORDER_PT = 1.5

/** Displayed page size (after the page's built-in rotation) in points. */
export function displaySize(box: PageBox, base: BaseRotation): { width: number; height: number } {
  return base === 90 || base === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height }
}

/**
 * Normalized point (0..1, top-left origin, in the displayed page) → PDF user space.
 * `base` is the page's built-in clockwise rotation.
 */
export function toPdfSpace(u: number, v: number, box: PageBox, base: BaseRotation): { x: number; y: number } {
  const { x: x0, y: y0, width: w, height: h } = box
  switch (base) {
    case 90:
      return { x: x0 + v * w, y: y0 + u * h }
    case 180:
      return { x: x0 + w - u * w, y: y0 + v * h }
    case 270:
      return { x: x0 + w - v * w, y: y0 + h - u * h }
    default:
      return { x: x0 + u * w, y: y0 + h - v * h }
  }
}

/** Characters the standard Helvetica font can draw (printable Latin-1). */
export const isLatin1Text = (text: string): boolean => /^[\n\x20-\x7E\xA0-\xFF]*$/.test(text)

export function parseColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

const colorOf = (hex: string): ReturnType<typeof rgb> => {
  const { r, g, b } = parseColor(hex)
  return rgb(r, g, b)
}

interface DrawContext {
  readonly out: PDFDocument
  readonly page: PDFPage
  readonly box: PageBox
  readonly base: BaseRotation
  readonly font: () => Promise<PDFFont>
  /** An embedded Unicode font (Thai + Latin), or null when none was supplied. */
  readonly unicodeFont: () => Promise<{ font: PDFFont; has: (text: string) => boolean } | null>
  readonly rasterize: TextRasterizer
}

function drawBox(ctx: DrawContext, a: BoxAnnotation): void {
  const p1 = toPdfSpace(a.x, a.y, ctx.box, ctx.base)
  const p2 = toPdfSpace(a.x + a.w, a.y + a.h, ctx.box, ctx.base)
  const rect = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y) }
  const color = colorOf(a.color)
  if (a.kind === 'rect') ctx.page.drawRectangle({ ...rect, borderColor: color, borderWidth: RECT_BORDER_PT })
  else ctx.page.drawRectangle({ ...rect, color, opacity: a.kind === 'highlight' ? HIGHLIGHT_OPACITY : 1 })
}

function drawPen(ctx: DrawContext, a: PenAnnotation): void {
  const { width: dw } = displaySize(ctx.box, ctx.base)
  const thickness = Math.max(0.1, a.width * dw)
  const color = colorOf(a.color)
  const pts = a.points.map((p) => toPdfSpace(p.x, p.y, ctx.box, ctx.base))
  const segments = pts.length === 1 ? [[pts[0], pts[0]] as const] : pts.slice(1).map((p, i) => [pts[i], p] as const)
  for (const [start, end] of segments) {
    ctx.page.drawLine({ start, end, thickness, color, lineCap: LineCapStyle.Round })
  }
}

async function drawText(ctx: DrawContext, a: TextAnnotation): Promise<void> {
  if (a.text.trim() === '') return
  const { height: dh } = displaySize(ctx.box, ctx.base)
  const sizePt = a.size * dh
  const lines = a.text.split('\n')
  const color = colorOf(a.color)

  if (isLatin1Text(a.text)) {
    const font = await ctx.font()
    lines.forEach((line, i) => {
      if (line === '') return
      const at = toPdfSpace(a.x, a.y + (i * LINE_HEIGHT + BASELINE) * a.size, ctx.box, ctx.base)
      ctx.page.drawText(line, { x: at.x, y: at.y, size: sizePt, font, color, rotate: degrees(ctx.base) })
    })
    return
  }

  const unicode = await ctx.unicodeFont()
  if (unicode?.has(a.text)) {
    lines.forEach((line, i) => {
      if (line === '') return
      const at = toPdfSpace(a.x, a.y + (i * LINE_HEIGHT + BASELINE) * a.size, ctx.box, ctx.base)
      ctx.page.drawText(line, { x: at.x, y: at.y, size: sizePt, font: unicode.font, color, rotate: degrees(ctx.base) })
    })
    return
  }

  // Characters even that font lacks (emoji, CJK…): fall back to a picture of the text.
  const raster = await ctx.rasterize(a.text, RASTER_FONT_PX, a.color)
  const image = await ctx.out.embedPng(raster.bytes)
  const scale = sizePt / RASTER_FONT_PX
  const heightPt = raster.height * scale
  const at = toPdfSpace(a.x, a.y + heightPt / dh, ctx.box, ctx.base)
  ctx.page.drawImage(image, { x: at.x, y: at.y, width: raster.width * scale, height: heightPt, rotate: degrees(ctx.base) })
}

async function drawAnnotation(ctx: DrawContext, a: Annotation): Promise<void> {
  if (a.kind === 'text') await drawText(ctx, a)
  else if (a.kind === 'pen') drawPen(ctx, a)
  else drawBox(ctx, a)
}

export interface BuildOptions {
  readonly rasterize: TextRasterizer
  /** Supplies the bytes of a TrueType font used for text beyond Latin-1 (e.g. Thai). */
  readonly loadFont?: () => Promise<Uint8Array>
  /** Export only these model page positions (default: all), e.g. one page for an image. */
  readonly only?: readonly number[]
}

/** Apply the model (page order, rotation, annotations) to the source PDFs and return the new file. */
export async function buildPdf(sources: readonly Uint8Array[], model: PdfModel, options: BuildOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const loaded = new Map<number, PDFDocument>()
  let font: PDFFont | undefined
  const getFont = async (): Promise<PDFFont> => (font ??= await out.embedFont(StandardFonts.Helvetica))

  let unicode: { font: PDFFont; has: (text: string) => boolean } | null | undefined
  const getUnicode = async (): Promise<{ font: PDFFont; has: (text: string) => boolean } | null> => {
    if (unicode !== undefined) return unicode
    if (!options.loadFont) return (unicode = null)
    out.registerFontkit(fontkit)
    const embedded = await out.embedFont(await options.loadFont(), { subset: true })
    const supported = new Set(embedded.getCharacterSet())
    const hasAll = (text: string): boolean => [...text].every((ch) => ch === '\n' || supported.has(ch.codePointAt(0) ?? 0))
    unicode = { font: embedded, has: hasAll }
    return unicode
  }

  const wanted = options.only ?? model.pages.map((_, i) => i)
  for (const at of wanted) {
    const entry = model.pages[at]
    if (!entry) continue
    let src = loaded.get(entry.source)
    if (!src) {
      const bytes = sources[entry.source]
      if (!bytes) throw new Error(`Missing PDF source ${entry.source}`)
      src = await PDFDocument.load(bytes)
      loaded.set(entry.source, src)
    }
    const [page] = await out.copyPages(src, [entry.index])
    const base = (((page.getRotation().angle % 360) + 360) % 360) as BaseRotation
    out.addPage(page)
    const ctx: DrawContext = { out, page, box: page.getCropBox(), base, font: getFont, unicodeFont: getUnicode, rasterize: options.rasterize }
    for (const annotation of entry.annotations) await drawAnnotation(ctx, annotation)
    if (entry.rotation !== 0) page.setRotation(degrees((base + entry.rotation) % 360))
  }
  return out.save()
}
