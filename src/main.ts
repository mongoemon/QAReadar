import './style.css'
import type { Command } from './lib/commands'
import { openTextFile, readFile, saveTextFile, type FileHandleLike, type FileKind, type OpenedFile } from './lib/fileAccess'
import { extensionOf, sniffKind, type SniffedKind } from './lib/fileKind'
import { makeRecentId } from './lib/recent'
import { listRecent, saveRecent, type StoredRecent } from './lib/recentStore'
import { readStored, writeStored } from './lib/safeStorage'
import { isThemePref, nextTheme, resolveDark, type ThemePref } from './lib/theme'
import { el } from './ui/dom'
import { createJsonTab } from './ui/jsonTab'
import { createLocatorTab } from './ui/locatorTab'
import { createMarkdownTab } from './ui/markdownTab'
import { createPalette } from './ui/palette'
import { STARTER_HTML, STARTER_JSON, STARTER_MARKDOWN } from './lib/samples'
import { errorMessage, toast } from './ui/toast'
import type { TabController } from './ui/types'

const THEME_KEY = 'mdreadar:theme'

const root = document.getElementById('app')
if (!root) throw new Error('#app container not found')

const tabs: TabController[] = [createMarkdownTab(), createJsonTab(), createLocatorTab()]
let active: TabController = tabs[0]

/** Kind used by the open picker and drag-drop: includes convertible extras, unlike save. */
const openKindOf = (tab: TabController): FileKind => ({
  ...tab.kind,
  extensions: [...tab.kind.extensions, ...(tab.extraExtensions ?? [])],
})

const tabById = (id: SniffedKind): TabController | undefined =>
  tabs.find((tab) => tab.id === id)

/** Route by extension; for unknown extensions, sniff the content (JSON vs markdown). */
const tabFor = (file: OpenedFile): TabController | undefined =>
  tabs.find((tab) => openKindOf(tab).extensions.includes(extensionOf(file.name))) ??
  tabById(sniffKind(file.text))

// ── chrome ────────────────────────────────────────────────────────────────
const tabButtons = new Map<TabController, HTMLButtonElement>()
const tabList = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tools' })
for (const tab of tabs) {
  const button = el('button', { class: 'tab', role: 'tab', type: 'button' }, tab.label)
  button.addEventListener('click', () => activate(tab))
  tabButtons.set(tab, button)
  tabList.append(button)
}

const chipName = el('span', { class: 'chip-name' })
const chipDot = el('span', { class: 'chip-dot', title: 'Unsaved changes' })
const chip = el('div', { class: 'chip' }, chipDot, chipName)

const openBtn = el('button', { class: 'btn', type: 'button' }, 'Open')
const recentBtn = el('button', { class: 'btn ghost', type: 'button' }, 'Recent')
const saveBtn = el('button', { class: 'btn primary', type: 'button' }, 'Save')
const saveAsBtn = el('button', { class: 'btn', type: 'button' }, 'Save as')
const themeBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Change theme' }, '')
const commandBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Open command palette' }, 'Ctrl+K')

const header = el(
  'header',
  { class: 'topbar' },
  el(
    'div',
    { class: 'brand-wrap' },
    el('h1', { class: 'brand' }, 'QAReadar'),
    el('span', { class: 'version', title: `Version ${__APP_VERSION__}` }, `v${__APP_VERSION__}`),
  ),
  tabList,
  chip,
  el('div', { class: 'actions' }, openBtn, recentBtn, saveBtn, saveAsBtn, themeBtn, commandBtn),
)
const main = el('main', { class: 'stage' }, ...tabs.map((tab) => tab.element))
const toastHost = el('div', { id: 'toast', class: 'toast', role: 'status' })
toastHost.hidden = true
const zenExit = el('button', { class: 'btn small zen-exit', type: 'button' }, 'Exit focus mode')
zenExit.hidden = true
root.append(header, main, toastHost, zenExit)

// ── theme ─────────────────────────────────────────────────────────────────
const storedTheme = readStored(THEME_KEY)
let themePref: ThemePref = isThemePref(storedTheme) ? storedTheme : 'auto'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(): void {
  if (themePref === 'auto') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.dataset.theme = themePref
  const dark = resolveDark(themePref, systemDark.matches)
  for (const tab of tabs) tab.setDark?.(dark)
  themeBtn.textContent = `Theme: ${themePref}`
}

function cycleTheme(): void {
  themePref = nextTheme(themePref)
  writeStored(THEME_KEY, themePref)
  applyTheme()
}

systemDark.addEventListener('change', applyTheme)

// ── focus mode ────────────────────────────────────────────────────────────
function setFocusMode(on: boolean): void {
  document.body.classList.toggle('zen', on)
  zenExit.hidden = !on
}
const toggleFocusMode = (): void => setFocusMode(!document.body.classList.contains('zen'))

// ── recent files ──────────────────────────────────────────────────────────
interface PermissionHandle extends FileHandleLike {
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
}

let recents: StoredRecent[] = []

async function refreshRecents(): Promise<void> {
  recents = await listRecent()
}

async function remember(tab: TabController, name: string, handle: FileHandleLike | null): Promise<void> {
  if (!handle) return
  await saveRecent({ id: makeRecentId(tab.id, name), name, tab: tab.id, openedAt: Date.now() }, handle)
  await refreshRecents()
}

async function openRecent(stored: StoredRecent): Promise<void> {
  const tab = tabs.find((t) => t.id === stored.entry.tab)
  if (!tab) return
  const handle = stored.handle as PermissionHandle
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'read' })) !== 'granted') {
    const answer = await handle.requestPermission?.({ mode: 'read' })
    if (answer !== 'granted') {
      toast('Permission to read the file was denied', true)
      return
    }
  }
  load(tab, await readFile(await handle.getFile(), handle))
}

// ── behaviour ─────────────────────────────────────────────────────────────
function refreshChip(): void {
  chipName.textContent = active.snapshot().name
  chipDot.hidden = !active.isDirty()
}

function activate(tab: TabController): void {
  active = tab
  for (const t of tabs) {
    const selected = t === tab
    t.element.hidden = !selected
    tabButtons.get(t)?.setAttribute('aria-selected', String(selected))
  }
  refreshChip()
}

function load(tab: TabController, file: OpenedFile): void {
  if (!tab.multiDoc && tab.isDirty() && !window.confirm('This tab has unsaved changes. Replace them?')) return
  tab.open(file)
  activate(tab)
  void remember(tab, file.name, file.handle)
}

async function guarded(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    toast(errorMessage(error), true)
  }
}

const openFile = (): Promise<void> =>
  guarded(async () => {
    const file = await openTextFile(tabs.map(openKindOf))
    if (!file) return
    const tab = tabFor(file)
    if (tab) load(tab, file)
    else toast(`Unsupported file type: ${file.name}`, true)
  })

const save = (forceNew: boolean): Promise<void> =>
  guarded(async () => {
    const saved = await saveTextFile(active.snapshot(), active.kind, forceNew)
    if (!saved) return
    active.markSaved(saved.name, saved.handle)
    toast(`Saved ${saved.name}`)
    void remember(active, saved.name, saved.handle)
  })

const palette = createPalette((): Command[] => [
  { id: 'file.open', title: 'File: Open…', hint: 'Ctrl+O', run: () => void openFile() },
  { id: 'file.save', title: 'File: Save', hint: 'Ctrl+S', run: () => void save(false) },
  { id: 'file.saveas', title: 'File: Save as…', hint: 'Ctrl+Shift+S', run: () => void save(true) },
  ...tabs.map((tab): Command => ({
    id: `tab.${tab.id}`,
    title: `Go to tab: ${tab.label}`,
    run: () => activate(tab),
  })),
  { id: 'view.theme', title: 'View: Change theme (auto / light / dark)', run: cycleTheme },
  { id: 'view.focus', title: 'View: Toggle focus mode', run: toggleFocusMode },
  ...recents.map((stored): Command => ({
    id: `recent.${stored.entry.id}`,
    title: `Recent: ${stored.entry.name}`,
    run: () => void guarded(() => openRecent(stored)),
  })),
  ...(active.commands?.() ?? []),
])

for (const tab of tabs) tab.onChange(() => tab === active && refreshChip())
openBtn.addEventListener('click', openFile)
recentBtn.addEventListener('click', () => palette.open('Recent'))
saveBtn.addEventListener('click', () => save(false))
saveAsBtn.addEventListener('click', () => save(true))
themeBtn.addEventListener('click', cycleTheme)
commandBtn.addEventListener('click', () => palette.open())
zenExit.addEventListener('click', () => setFocusMode(false))

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && document.body.classList.contains('zen')) {
    setFocusMode(false)
    return
  }
  if (!(ev.ctrlKey || ev.metaKey)) return
  const key = ev.key.toLowerCase()
  if (key === 's') {
    ev.preventDefault()
    void save(ev.shiftKey)
  } else if (key === 'o') {
    ev.preventDefault()
    void openFile()
  } else if (key === 'k') {
    ev.preventDefault()
    palette.open()
  }
})

interface DroppedItem {
  readonly file: File
  readonly handle: Promise<FileHandleLike | null>
}

/** Must run synchronously inside the drop event: DataTransfer items expire afterwards. */
function collectDropped(transfer: DataTransfer): DroppedItem[] {
  return [...transfer.items].flatMap((item): DroppedItem[] => {
    const file = item.getAsFile()
    if (!file) return []
    const getHandle = (item as unknown as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle
    const handle = getHandle
      ? getHandle.call(item).then((h) => ((h as { kind?: string } | null)?.kind === 'file' ? (h as FileHandleLike) : null), () => null)
      : Promise.resolve(null)
    return [{ file, handle }]
  })
}

window.addEventListener('dragover', (ev) => ev.preventDefault())
window.addEventListener('drop', (ev) => {
  ev.preventDefault()
  if (!ev.dataTransfer) return
  const dropped = collectDropped(ev.dataTransfer)
  void guarded(async () => {
    for (const { file, handle } of dropped) {
      const opened = await readFile(file, await handle)
      const tab = tabFor(opened)
      if (!tab) {
        toast(`Unsupported file type: ${file.name}`, true)
        continue
      }
      load(tab, opened)
    }
  })
})

window.addEventListener('beforeunload', (ev) => {
  if (tabs.some((tab) => tab.isDirty())) ev.preventDefault()
})

// Starter documents: unsaved (no handle), so the first Save asks where to put them.
for (const [tab, starter] of [[tabs[0], STARTER_MARKDOWN], [tabs[1], STARTER_JSON], [tabs[2], STARTER_HTML]] as const) {
  tab.open({ name: starter.fileName, text: starter.text, handle: null })
}

applyTheme()
activate(active)
void refreshRecents()

// Offline support is best-effort: a failed registration must not affect the app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}
