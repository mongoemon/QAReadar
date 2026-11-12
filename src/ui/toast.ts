const TOAST_MS = 3200

let timer: number | undefined

export function toast(message: string, isError = false): void {
  const host = document.getElementById('toast')
  if (!host) return
  host.textContent = message
  host.dataset.kind = isError ? 'error' : 'info'
  host.hidden = false
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    host.hidden = true
  }, TOAST_MS)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
