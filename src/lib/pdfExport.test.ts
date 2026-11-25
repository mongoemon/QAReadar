import { readFileSync } from 'node:fs'
import { PDFDict, PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildPdf, displaySize, isLatin1Text, parseColor, toPdfSpace, type Raster } from './pdfExport'
import { addAnnotation, appendSource, deletePage, EMPTY_MODEL, movePage, rotatePage } from './pdfModel'

const BOX = { x: 0, y: 0, width: 200, height: 100 }

// 1×1 transparent PNG
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
    .split('')
    .map((c) => c.charCodeAt(0)),
)
const rasterize = async (): Promise<Raster> => ({ bytes: PNG, width: 100, height: 70 })

async function samplePdf(pages: number, rotateFirst = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 100]).setRotation(degrees(i === 0 ? rotateFirst : 0))
  return doc.save()
}

describe('toPdfSpace', () => {
  it('maps the displayed top-left corner for each built-in rotation', () => {
    expect(toPdfSpace(0, 0, BOX, 0)).toEqual({ x: 0, y: 100 })
    expect(toPdfSpace(0, 0, BOX, 90)).toEqual({ x: 0, y: 0 })
    expect(toPdfSpace(0, 0, BOX, 180)).toEqual({ x: 200, y: 0 })
    expect(toPdfSpace(0, 0, BOX, 270)).toEqual({ x: 200, y: 100 })
  })

  it('maps the displayed bottom-right corner for each built-in rotation', () => {
    expect(toPdfSpace(1, 1, BOX, 0)).toEqual({ x: 200, y: 0 })
    expect(toPdfSpace(1, 1, BOX, 90)).toEqual({ x: 200, y: 100 })
    expect(toPdfSpace(1, 1, BOX, 180)).toEqual({ x: 0, y: 100 })
    expect(toPdfSpace(1, 1, BOX, 270)).toEqual({ x: 0, y: 0 })
  })

  it('honours a page box that does not start at the origin', () => {
    expect(toPdfSpace(0, 0, { x: 10, y: 20, width: 200, height: 100 }, 0)).toEqual({ x: 10, y: 120 })
  })

  it('swaps width and height for sideways pages', () => {
    expect(displaySize(BOX, 90)).toEqual({ width: 100, height: 200 })
    expect(displaySize(BOX, 0)).toEqual({ width: 200, height: 100 })
  })
})

describe('helpers', () => {
  it('detects text the standard font cannot draw', () => {
    expect(isLatin1Text('Hello é\nworld')).toBe(true)
    expect(isLatin1Text('สวัสดี')).toBe(false)
    expect(isLatin1Text('€')).toBe(false)
  })

  it('parses hex colours and falls back to black', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
    expect(parseColor('nonsense')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('buildPdf', () => {
  it('keeps, reorders and drops pages', async () => {
    const bytes = await samplePdf(3)
    let model = appendSource(EMPTY_MODEL, 0, 3)
    model = movePage(model, 0, 2)
    model = deletePage(model, 0)
    const out = await PDFDocument.load(await buildPdf([bytes], model, { rasterize }))
    expect(out.getPageCount()).toBe(2)
  })

  it('applies the user rotation on top of the built-in one', async () => {
    const bytes = await samplePdf(1, 90)
    const model = rotatePage(appendSource(EMPTY_MODEL, 0, 1), 0, true)
    const out = await PDFDocument.load(await buildPdf([bytes], model, { rasterize }))
    expect(out.getPage(0).getRotation().angle).toBe(180)
  })

  it('merges pages from two sources', async () => {
    const a = await samplePdf(2)
    const b = await samplePdf(3)
    const model = appendSource(appendSource(EMPTY_MODEL, 0, 2), 1, 3)
    const out = await PDFDocument.load(await buildPdf([a, b], model, { rasterize }))
    expect(out.getPageCount()).toBe(5)
  })

  it('exports only the requested pages', async () => {
    const bytes = await samplePdf(3)
    const model = appendSource(EMPTY_MODEL, 0, 3)
    const out = await PDFDocument.load(await buildPdf([bytes], model, { rasterize, only: [1] }))
    expect(out.getPageCount()).toBe(1)
  })

  it('draws every annotation kind, rasterizing non-Latin text', async () => {
    const bytes = await samplePdf(1)
    let model = appendSource(EMPTY_MODEL, 0, 1)
    const base = { color: '#112233' }
    model = addAnnotation(model, 0, { ...base, id: 1, kind: 'text', x: 0.1, y: 0.1, text: 'Hello\nworld', size: 0.1 })
    model = addAnnotation(model, 0, { ...base, id: 2, kind: 'text', x: 0.1, y: 0.5, text: 'สวัสดี', size: 0.1 })
    model = addAnnotation(model, 0, { ...base, id: 3, kind: 'highlight', x: 0.1, y: 0.1, w: 0.2, h: 0.1 })
    model = addAnnotation(model, 0, { ...base, id: 4, kind: 'rect', x: 0.5, y: 0.1, w: 0.2, h: 0.1 })
    model = addAnnotation(model, 0, { ...base, id: 5, kind: 'cover', x: 0.5, y: 0.5, w: 0.2, h: 0.1 })
    model = addAnnotation(model, 0, { ...base, id: 6, kind: 'pen', width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.3 }] })
    let rasterCalls = 0
    const counting = async (): Promise<Raster> => {
      rasterCalls++
      return rasterize()
    }
    const result = await buildPdf([bytes], model, { rasterize: counting })
    expect(rasterCalls).toBe(1)
    expect((await PDFDocument.load(result)).getPageCount()).toBe(1)
    expect(result.length).toBeGreaterThan(bytes.length)
  })

  it('embeds the Thai font as real text instead of a picture', async () => {
    const font = new Uint8Array(readFileSync('src/assets/fonts/Sarabun-Regular.ttf'))
    let rasterCalls = 0
    const counting = async (): Promise<Raster> => {
      rasterCalls++
      return rasterize()
    }
    let model = appendSource(EMPTY_MODEL, 0, 1)
    model = addAnnotation(model, 0, { id: 1, kind: 'text', x: 0.1, y: 0.1, text: 'Hello สวัสดี\nบรรทัดสอง', size: 0.05, color: '#000000' })
    const bytes = await samplePdf(1)
    const withFont = await buildPdf([bytes], model, { rasterize: counting, loadFont: async () => font })
    const objects = (await PDFDocument.load(withFont)).context.enumerateIndirectObjects().map(([, object]) => object)
    const hasEntry = (key: string, value?: string): boolean =>
      objects.some((object) => {
        const dict = object instanceof PDFDict ? object : object instanceof PDFRawStream ? object.dict : undefined
        const found = dict?.get(PDFName.of(key))
        return found !== undefined && (value === undefined || found.toString() === value)
      })
    expect(rasterCalls).toBe(0)
    expect(hasEntry('FontFile2')).toBe(true)
    expect(hasEntry('Subtype', '/Image')).toBe(false)
  })

  it('still falls back to a picture for characters the font lacks', async () => {
    const font = new Uint8Array(readFileSync('src/assets/fonts/Sarabun-Regular.ttf'))
    let rasterCalls = 0
    const counting = async (): Promise<Raster> => {
      rasterCalls++
      return rasterize()
    }
    const model = addAnnotation(appendSource(EMPTY_MODEL, 0, 1), 0, { id: 1, kind: 'text', x: 0.1, y: 0.1, text: '日本語', size: 0.05, color: '#000000' })
    await buildPdf([await samplePdf(1)], model, { rasterize: counting, loadFont: async () => font })
    expect(rasterCalls).toBe(1)
  })

  it('fails clearly when a source is missing', async () => {
    const model = appendSource(EMPTY_MODEL, 3, 1)
    await expect(buildPdf([], model, { rasterize })).rejects.toThrow('Missing PDF source 3')
  })
})
