import { parse as parseYaml } from 'yaml'
import type { ParseResult } from './jsonPath'

export type ConvertFormat = 'jsonl' | 'csv' | 'yaml'

const EXTENSION_FORMATS: Readonly<Record<string, ConvertFormat>> = {
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  csv: 'csv',
  yaml: 'yaml',
  yml: 'yaml',
}

export const CONVERTIBLE_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_FORMATS)

export function formatFromFileName(name: string): ConvertFormat | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_FORMATS[ext] ?? null
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function fromJsonLines(text: string): ParseResult {
  const rows: unknown[] = []
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (line === '') continue
    try {
      rows.push(JSON.parse(line))
    } catch (e) {
      return { ok: false, error: `Line ${n + 1}: ${message(e)}` }
    }
  }
  return rows.length === 0 ? { ok: false, error: 'Empty input' } : { ok: true, value: rows }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const)
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0]
}

function parseCsvRows(text: string, delimiter: string): string[][] | null {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0

  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 2
        continue
      }
      if (c === '"') quoted = false
      else cell += c
      i++
      continue
    }
    if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
    i++
  }
  if (quoted) return null
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function uniqueHeaders(header: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return header.map((raw, index) => {
    const base = raw.trim() === '' ? `column${index + 1}` : raw
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}

function fromCsv(input: string): ParseResult {
  const text = input.replace(/^﻿/, '')
  if (text.trim() === '') return { ok: false, error: 'Empty input' }
  const rows = parseCsvRows(text, detectDelimiter(text))
  if (rows === null) return { ok: false, error: 'Unterminated quote in CSV' }
  if (rows.length === 0) return { ok: false, error: 'Empty input' }

  const [headerRow, ...body] = rows
  const header = uniqueHeaders(headerRow)
  const records = body.map((cells) => {
    const record: Record<string, string> = {}
    header.forEach((name, index) => {
      record[name] = cells[index] ?? ''
    })
    for (let extra = header.length; extra < cells.length; extra++) {
      record[`column${extra + 1}`] = cells[extra]
    }
    return record
  })
  return { ok: true, value: records }
}

function fromYaml(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, error: 'Empty input' }
  try {
    const value: unknown = parseYaml(text)
    return value === undefined ? { ok: false, error: 'Empty input' } : { ok: true, value }
  } catch (e) {
    return { ok: false, error: message(e) }
  }
}

export function convertToJson(format: ConvertFormat, text: string): ParseResult {
  switch (format) {
    case 'jsonl':
      return fromJsonLines(text)
    case 'csv':
      return fromCsv(text)
    case 'yaml':
      return fromYaml(text)
  }
}
