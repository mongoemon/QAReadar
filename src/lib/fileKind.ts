export type SniffedKind = 'json' | 'markdown'

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/**
 * True for content that is not text (images, PDFs, archives…): a NUL character never appears
 * in real text files, but shows up within the first few KB of practically every binary format.
 */
export const looksBinary = (text: string): boolean => text.slice(0, 8192).includes('\u0000')

/** Guess a kind from content, for files whose extension is unknown. */
export function sniffKind(text: string): SniffedKind {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      return 'markdown'
    }
  }
  return 'markdown'
}
