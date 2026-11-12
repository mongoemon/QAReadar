export type SniffedKind = 'json' | 'markdown'

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

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
