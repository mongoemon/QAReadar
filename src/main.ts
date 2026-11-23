import './style.css'
import type { Command } from './lib/commands'
import { attachChangelog } from './ui/changelog'
import { openTextFile, readFile, readHandle, saveTextFile, type FileHandleLike, type FileKind, type OpenedFile } from './lib/fileAccess'
import { extensionOf, looksBinary, sniffKind, type SniffedKind } from './lib/fileKind'
import { makeRecentId } from './lib/recent'
import { listRecent, saveRecent, type StoredRecent } from './lib/recentStore'
import { readStored, writeStored } from './lib/safeStorage'
import { isThemePref, nextTheme, resolveDark, type ThemePref } from './lib/theme'
import { getLang, localized, nextLang, setLang, t, type MessageKey } from './lib/i18n'
import { el } from './ui/dom'
import { icon, iconButton, setIconButton, type IconName } from './ui/icons'
import { createJsonTab } from './ui/jsonTab'
import { createLocatorTab } from './ui/locatorTab'
import { createMarkdownTab } from './ui/markdownTab'
import { createMergeTab } from './ui/mergeTab'
import { createPalette } from './ui/palette'
import { createTextTab } from './ui/textTab'
import { STARTER_CSV, STARTER_HTML, STARTER_JSON, STARTER_MARKDOWN, STARTER_MERGE, STARTER_TEXT, type Starter } from './lib/samples'
import { closeMenu, showMenu } from './ui/menu'
import { comboFor, comboFromEvent, scopeOf, shortcutLabel, withShortcuts } from './lib/shortcuts'
import { createShortcutsDialog, type ShortcutGroup } from './ui/shortcutsDialog'
import { errorMessage, toast } from './ui/toast'
import type { TabController } from './ui/types'

const THEME_KEY = 'mdreadar:theme'

const root = document.getElementById('app')
if (!root) throw new Error('#app container not found')

const markdownTab = createMarkdownTab()
const jsonTab = createJsonTab()
const locatorTab = createLocatorTab()
// Text sits after Markdown, so .txt keeps opening in Markdown; logs, CSV, YAML… open here.
const textTab = createTextTab()
const mergeTab = createMergeTab(STARTER_MERGE)
const tabs: TabController[] = [markdownTab, textTab, jsonTab, locatorTab, mergeTab]
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
  looksBinary(file.text) ? undefined :
  tabs.find((tab) => openKindOf(tab).extensions.includes(extensionOf(file.name))) ??
  tabById(sniffKind(file.text))

// ── chrome ────────────────────────────────────────────────────────────────
const TAB_ICONS: Partial<Record<string, IconName>> = { markdown: 'fileText', json: 'braces', locator: 'crosshair', merge: 'gitCompare', text: 'notepad' }
const tabButtons = new Map<TabController, HTMLButtonElement>()
const tabList = el('div', { class: 'tabs', role: 'tablist' })
for (const tab of tabs) {
  const label = el('span', {})
  const button = el('button', { class: 'tab', role: 'tab', type: 'button' }, icon(TAB_ICONS[tab.id] ?? 'fileText'), label)
  const render = (): void => {
    label.textContent = tab.label
    const key = shortcutLabel(`tab.${tab.id}`)
    button.title = key ? `${tab.label} (${key})` : tab.label
  }
  localized(render)
  withShortcuts(render)
  button.addEventListener('click', () => activate(tab))
  tabButtons.set(tab, button)
  tabList.append(button)
}

const chipName = el('span', { class: 'chip-name' })
const chipDot = el('span', { class: 'chip-dot' })
const chip = el('div', { class: 'chip' }, chipDot, chipName)

const samplesBtn = iconButton('sample', () => t('top.samplesTip'), { variant: 'ghost samples-btn', text: () => t('top.samples'), shortcut: () => shortcutLabel('file.samples'), attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } })
const openBtn = iconButton('open', () => t('top.open'), { variant: 'ghost', shortcut: () => shortcutLabel('file.open') })
const recentBtn = iconButton('recent', () => t('top.recent'), { variant: 'ghost', shortcut: () => shortcutLabel('file.recent') })
const saveBtn = iconButton('save', () => t('top.save'), { variant: 'primary', text: () => t('top.save'), shortcut: () => shortcutLabel('file.save') })
const saveAsBtn = iconButton('saveAs', () => t('top.saveAs'), { variant: 'ghost', shortcut: () => shortcutLabel('file.saveas') })
const themeBtn = iconButton('monitor', '', { variant: 'ghost' })
const langBtn = iconButton('languages', () => t('top.lang'), { variant: 'ghost lang-btn', text: () => getLang().toUpperCase(), shortcut: () => shortcutLabel('view.lang') })
const focusBtn = iconButton('focus', () => t('top.focus'), { variant: 'ghost', shortcut: () => shortcutLabel('view.focus') })
const commandBtn = iconButton('command', () => t('top.command'), { variant: 'ghost', shortcut: () => shortcutLabel('view.palette') })
const shortcutsBtn = iconButton('keyboard', () => t('top.shortcuts'), { variant: 'ghost', shortcut: () => shortcutLabel('help.shortcuts') })
const THEME_ICONS: Record<ThemePref, IconName> = { auto: 'monitor', light: 'sun', dark: 'moon' }

const REPO_URL = 'https://github.com/mongoemon/QAReadar'
const GITHUB_ICON_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z'

function githubLink(): HTMLAnchorElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', GITHUB_ICON_PATH)
  svg.append(path)
  const link = el('a', { class: 'github-link', href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, svg)
  localized(() => {
    link.setAttribute('aria-label', t('top.githubAria'))
    link.title = t('top.github')
  })
  return link
}

const versionBadge = el('button', { class: 'version', type: 'button' }, `v${__APP_VERSION__}`)
localized(() => {
  versionBadge.title = t('version.title', { v: __APP_VERSION__ })
  versionBadge.setAttribute('aria-label', t('version.aria', { v: __APP_VERSION__ }))
})
const changelog = attachChangelog(versionBadge, __APP_VERSION__)

const header = el(
  'header',
  { class: 'topbar' },
  el(
    'div',
    { class: 'brand-wrap' },
    el('h1', { class: 'brand' }, 'QAReadar'),
    versionBadge,
  ),
  tabList,
  chip,
  el('div', { class: 'actions' }, samplesBtn, openBtn, recentBtn, saveAsBtn, saveBtn, el('span', { class: 'actions-sep', 'aria-hidden': 'true' }), themeBtn, langBtn, focusBtn, shortcutsBtn, commandBtn, githubLink()),
)
const main = el('main', { class: 'stage' }, ...tabs.map((tab) => tab.element))
const toastHost = el('div', { id: 'toast', class: 'toast', role: 'status' })
toastHost.hidden = true
const zenExit = iconButton('exitFocus', () => t('zen.exit'), { variant: 'ghost zen-exit', shortcut: () => ['Esc', shortcutLabel('view.focus')].filter(Boolean).join(' / ') })
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
  renderThemeBtn()
}

function renderThemeBtn(): void {
  setIconButton(themeBtn, THEME_ICONS[themePref], t('top.theme', { theme: t(`theme.${themePref}`) }), undefined, shortcutLabel('view.theme'))
}

function cycleTheme(): void {
  themePref = nextTheme(themePref)
  writeStored(THEME_KEY, themePref)
  applyTheme()
}

systemDark.addEventListener('change', applyTheme)

// ── language ──────────────────────────────────────────────────────────────
const cycleLang = (): void => setLang(nextLang(getLang()))
localized(() => {
  tabList.setAttribute('aria-label', t('tabs.aria'))
  chipDot.title = t('chip.unsaved')
  renderThemeBtn()
})
withShortcuts(renderThemeBtn)

// ── focus mode ────────────────────────────────────────────────────────────
function setFocusMode(on: boolean): void {
  document.body.classList.toggle('zen', on)
  zenExit.hidden = !on
}
const toggleFocusMode = (): void => setFocusMode(!document.body.classList.contains('zen'))

// ── recent files ──────────────────────────────────────────────────────────
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
  const result = await readHandle(stored.handle, true)
  if (result.status === 'denied') toast(t('msg.readDenied'), true)
  else if (result.status === 'missing') toast(t('msg.recentMissing', { name: stored.entry.name }), true)
  else load(tab, result.file)
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
  if (!tab.multiDoc && tab.isDirty() && !window.confirm(t('confirm.replaceTab'))) return
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
    else toast(t('msg.unsupported', { name: file.name }), true)
  })

const save = (forceNew: boolean): Promise<void> =>
  guarded(async () => {
    const saved = await saveTextFile(active.snapshot(), active.kind, forceNew)
    if (!saved) return
    active.markSaved(saved.name, saved.handle)
    toast(t('msg.saved', { name: saved.name }))
    void remember(active, saved.name, saved.handle)
  })

// ── samples (nothing is preloaded: each tool's example opens on demand) ──
interface Sample {
  readonly id: string
  readonly label: MessageKey
  readonly icon: IconName
  readonly tab: TabController
  /** Single file opened into the tab; absent for the merge pair. */
  readonly file?: Starter
}
const SAMPLES: readonly Sample[] = [
  { id: 'markdown', label: 'sample.markdown', icon: 'fileText', tab: markdownTab, file: STARTER_MARKDOWN },
  { id: 'text', label: 'sample.text', icon: 'notepad', tab: textTab, file: STARTER_TEXT },
  { id: 'csv', label: 'sample.csv', icon: 'table', tab: textTab, file: STARTER_CSV },
  { id: 'json', label: 'sample.json', icon: 'braces', tab: jsonTab, file: STARTER_JSON },
  { id: 'locator', label: 'sample.locator', icon: 'crosshair', tab: locatorTab, file: STARTER_HTML },
  { id: 'merge', label: 'sample.merge', icon: 'gitCompare', tab: mergeTab },
]

function openSample(sample: Sample): void {
  if (!sample.file) {
    if (mergeTab.isDirty() && !window.confirm(t('confirm.replaceTab'))) return
    mergeTab.loadSample()
    activate(mergeTab)
    toast(t('sample.loaded', { name: `${STARTER_MERGE.manual.fileName} ↔ ${STARTER_MERGE.automate.fileName}` }))
    return
  }
  // Unsaved and unlinked, so the first Save asks where to put it; never added to Recent.
  const { tab, file } = sample
  if (!tab.multiDoc && tab.isDirty() && !window.confirm(t('confirm.replaceTab'))) return
  tab.open({ name: file.fileName, text: file.text, handle: null, sample: true })
  activate(tab)
  toast(t('sample.loaded', { name: file.fileName }))
}

function openSamplesMenu(): void {
  if (closeMenu()) return
  showMenu(
    SAMPLES.map((sample) => ({ label: t(sample.label), icon: sample.icon, run: () => openSample(sample) })),
    samplesBtn,
    t('top.samples'),
  )
}

/** App-wide commands: in the palette, and bindable in the shortcut editor. */
function globalCommands(): Command[] {
  const step = (by: number) => (): void => activate(tabs[(tabs.indexOf(active) + by + tabs.length) % tabs.length])
  return [
    { id: 'file.open', title: t('cmd.open'), run: () => void openFile() },
    { id: 'file.save', title: t('cmd.save'), run: () => void save(false) },
    { id: 'file.saveas', title: t('cmd.saveAs'), run: () => void save(true) },
    { id: 'file.recent', title: t('cmd.recentList'), run: () => palette.open(t('palette.recentQuery')) },
    { id: 'file.samples', title: t('cmd.samples'), run: openSamplesMenu },
    ...tabs.map((tab): Command => ({
      id: `tab.${tab.id}`,
      title: t('cmd.goTab', { tab: tab.label }),
      run: () => activate(tab),
    })),
    { id: 'tab.next', title: t('cmd.nextTab'), run: step(1) },
    { id: 'tab.prev', title: t('cmd.prevTab'), run: step(-1) },
    { id: 'view.palette', title: t('cmd.palette'), run: () => palette.open() },
    { id: 'view.theme', title: t('cmd.theme'), run: cycleTheme },
    { id: 'view.focus', title: t('cmd.focus'), run: toggleFocusMode },
    { id: 'view.lang', title: t('cmd.lang'), run: cycleLang },
    { id: 'help.shortcuts', title: t('cmd.shortcuts'), run: () => shortcuts.open() },
    { id: 'help.changelog', title: t('cmd.changelog', { v: __APP_VERSION__ }), run: changelog.open },
    ...SAMPLES.map((sample): Command => ({
      id: `sample.${sample.id}`,
      title: t('cmd.sample', { name: t(sample.label) }),
      run: () => openSample(sample),
    })),
  ]
}

/** Palette hints always show the live binding, on this machine's keys. */
const withHint = (command: Command): Command => ({ ...command, hint: shortcutLabel(command.id) })

const palette = createPalette((): Command[] =>
  [
    ...globalCommands().filter((c) => c.id !== 'view.palette'),
    ...recents.map((stored): Command => ({
      id: `recent.${stored.entry.id}`,
      title: t('cmd.recent', { name: stored.entry.name }),
      run: () => void guarded(() => openRecent(stored)),
    })),
    ...(active.commands?.() ?? []),
  ].map(withHint),
)

const shortcuts = createShortcutsDialog((): ShortcutGroup[] => [
  { title: t('sc.general'), commands: globalCommands() },
  ...tabs.flatMap((tab) => {
    const commands = tab.commands?.() ?? []
    return commands.length ? [{ title: tab.label, commands }] : []
  }),
])

for (const tab of tabs) tab.onChange(() => tab === active && refreshChip())
samplesBtn.addEventListener('click', openSamplesMenu)
openBtn.addEventListener('click', openFile)
recentBtn.addEventListener('click', () => palette.open(t('palette.recentQuery')))
saveBtn.addEventListener('click', () => save(false))
saveAsBtn.addEventListener('click', () => save(true))
themeBtn.addEventListener('click', cycleTheme)
langBtn.addEventListener('click', cycleLang)
focusBtn.addEventListener('click', () => setFocusMode(true))
commandBtn.addEventListener('click', () => palette.open())
shortcutsBtn.addEventListener('click', () => shortcuts.open())
zenExit.addEventListener('click', () => setFocusMode(false))

/**
 * One dispatcher for every shortcut (see lib/shortcuts.ts). Capture phase, so a bound combo
 * beats the editors' and the browser's own handling; unbound keys pass through untouched.
 * The active tab's commands win over global ones when both use the same keys.
 */
window.addEventListener(
  'keydown',
  (ev) => {
    if (ev.isComposing || shortcuts.isOpen()) return
    if (ev.key === 'Escape' && document.body.classList.contains('zen')) {
      setFocusMode(false)
      return
    }
    // Plain typing never matches a binding (only modifier combos and F-keys are bindable).
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !/^F\d{1,2}$/.test(ev.code)) return
    const combo = comboFromEvent(ev)
    if (!combo || palette.isOpen()) return
    const candidates = [...(active.commands?.() ?? []), ...globalCommands()]
    const command = candidates.find((c) => comboFor(c.id) === combo && (scopeOf(c.id) === 'global' || scopeOf(c.id) === active.id))
    if (!command) return
    ev.preventDefault()
    ev.stopPropagation()
    command.run()
  },
  true,
)

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

const carriesFiles = (ev: DragEvent): boolean => ev.dataTransfer?.types.includes('Files') ?? false

// Capture phase: file drops must reach us before the editors. Otherwise the WYSIWYG editor
// (ProseMirror + Toast UI) handles them itself — e.g. it embeds a dropped image as a multi-MB
// base64 data URL and stops propagation, which can hang the page.
// Text/HTML drags (moving a selection inside an editor) are left alone.
window.addEventListener(
  'dragover',
  (ev) => {
    ev.preventDefault()
    if (!carriesFiles(ev)) return
    ev.stopPropagation()
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
  },
  true,
)
window.addEventListener(
  'drop',
  (ev) => {
    if (!carriesFiles(ev) || !ev.dataTransfer) return
    ev.preventDefault()
    ev.stopPropagation()
    openDropped(ev.dataTransfer, ev.target)
  },
  true,
)
// Anything else that reaches the window unhandled must not make the browser navigate away.
window.addEventListener('drop', (ev) => ev.preventDefault())

function openDropped(transfer: DataTransfer, target: EventTarget | null): void {
  const dropped = collectDropped(transfer)
  void guarded(async () => {
    for (const { file, handle } of dropped) {
      const opened = await readFile(file, await handle)
      // A tab may claim drops onto its own surface (the merge tab: onto Manual or Automate).
      if (active.acceptDrop?.(opened, target)) continue
      const tab = tabFor(opened)
      if (!tab) {
        toast(t('msg.unsupported', { name: file.name }), true)
        continue
      }
      load(tab, opened)
    }
  })
}

window.addEventListener('beforeunload', (ev) => {
  if (tabs.some((tab) => tab.isDirty())) ev.preventDefault()
})

applyTheme()
activate(active)
void refreshRecents()

// Offline support is best-effort: a failed registration must not affect the app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}
