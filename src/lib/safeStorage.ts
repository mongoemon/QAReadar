// Storage can be blocked (private mode) or full. Preferences and drafts are best-effort,
// so failures return a fallback instead of breaking the app.

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // intentionally non-fatal, see note above
  }
}
