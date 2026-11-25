// Keeping the Markdown tab honest about the files on disk: missing / changed detection,
// reloading, and the toolbar's refresh button and warning.
import { activeDoc, isDocDirty, replaceDoc, type DocSet } from '../../lib/docSet'
import { judgeProbe, type DiskState } from '../../lib/docSession'
import { readHandle, statHandle, type FileHandleLike } from '../../lib/fileAccess'
import { t } from '../../lib/i18n'
import { el } from '../dom'
import { iconButton } from '../icons'
import { toast } from '../toast'

export interface DiskHost {
  getSet(): DocSet
  setSet(set: DocSet): void
  editorText(): string
  /** Show the active document again. */
  show(): void
  renderTabs(): void
  persist(): void
}

export interface DiskSync {
  readonly refreshButton: HTMLButtonElement
  readonly warning: HTMLElement
  stampOf(id: string): number | undefined
  setStamp(id: string, stamp: number): void
  isMissing(id: string): boolean
  /** Drop everything known about a closed document. */
  forget(id: string): void
  /** Our own write is not an "external change", and a saved file exists on disk again. */
  saved(id: string): void
  restamp(id: string, handle: FileHandleLike | null): Promise<void>
  check(): Promise<void>
  /** Reload the active document from its file, reporting problems as toasts. */
  refresh(): void
  /** Update the button and warning for the active document. */
  render(): void
  /** Re-apply the warning's text after a language change. */
  localize(): void
}

export function createDiskSync(host: DiskHost): DiskSync {
  /** File lastModified when each doc was last read from / written to disk. */
  const stamps = new Map<string, number>()
  /** Docs whose file vanished from disk, or changed there since we read it. */
  const states = new Map<string, DiskState>()
  let checking = false

  const refreshButton = iconButton('refresh', () => t('md.refresh'), { variant: 'ghost refresh-btn' })
  const warningText = el('span', {})
  const warning = el(
    'span',
    { class: 'disk-warn', role: 'status' },
    el('span', { class: 'disk-warn-dot', 'aria-hidden': 'true' }),
    warningText,
  )
  warning.hidden = true

  /** Background probe (no permission prompts). Text in the app is never touched here. */
  async function check(): Promise<void> {
    if (checking) return
    checking = true
    try {
      let changed = false
      for (const doc of host.getSet().docs) {
        if (!doc.handle) continue
        const result = await statHandle(doc.handle)
        if (result === 'unknown') continue
        const before = states.get(doc.id)
        const { state: next, stamp } = judgeProbe(stamps.get(doc.id), result)
        if (stamp !== undefined) stamps.set(doc.id, stamp)
        if (next) states.set(doc.id, next)
        else states.delete(doc.id)
        changed ||= before !== next
      }
      if (changed) host.renderTabs()
    } finally {
      checking = false
    }
  }

  async function reload(): Promise<void> {
    const doc = activeDoc(host.getSet())
    if (!doc.handle) {
      toast(t('md.notLinked'), true)
      return
    }
    const result = await readHandle(doc.handle, true)
    if (result.status === 'denied') {
      toast(t('msg.readDenied'), true)
      return
    }
    if (result.status === 'missing') {
      states.set(doc.id, 'missing')
      host.renderTabs()
      toast(t('md.missing', { name: doc.name }), true)
      return
    }
    const current = activeDoc(host.getSet())
    if (current.id !== doc.id) return // user switched documents while we were reading
    if (isDocDirty(current) && !window.confirm(t('md.confirmReload', { name: current.name }))) {
      return
    }
    const before = host.editorText()
    const { file } = result
    if (file.lastModified !== undefined) stamps.set(doc.id, file.lastModified)
    states.delete(doc.id)
    host.setSet(replaceDoc(host.getSet(), doc.id, { ...current, name: file.name, text: file.text, savedText: file.text }))
    host.show()
    toast(t(host.editorText() === before ? 'md.upToDate' : 'md.reloaded', { name: file.name }))
  }

  const refresh = (): void => void reload().catch((e) => toast(String(e), true))

  async function restamp(id: string, handle: FileHandleLike | null): Promise<void> {
    if (!handle) return
    const result = await statHandle(handle)
    if (typeof result === 'number') stamps.set(id, result)
    host.persist()
  }

  function render(): void {
    const doc = activeDoc(host.getSet())
    const state = states.get(doc.id)
    warning.hidden = state !== 'missing'
    refreshButton.disabled = !doc.handle
    refreshButton.classList.toggle('has-update', state === 'changed')
    refreshButton.title = !doc.handle
      ? t('md.refreshNoFile')
      : state === 'changed'
        ? t('md.refreshChanged')
        : t('md.refreshTip')
  }

  refreshButton.addEventListener('click', refresh)
  // Re-check files when the user comes back from another app (where they may have edited them).
  window.addEventListener('focus', () => void check())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })

  return {
    refreshButton,
    warning,
    stampOf: (id) => stamps.get(id),
    setStamp: (id, stamp) => void stamps.set(id, stamp),
    isMissing: (id) => states.get(id) === 'missing',
    forget(id) {
      stamps.delete(id)
      states.delete(id)
    },
    saved: (id) => void states.delete(id),
    restamp,
    check,
    refresh,
    render,
    localize() {
      warning.title = t('md.diskWarnTip')
      warningText.textContent = t('md.diskWarn')
    },
  }
}
