import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import type { Command } from '../lib/commands'
import { localized, t } from '../lib/i18n'
import { icon, iconButton, setIconButton, type IconName } from './icons'
import {
  activeDoc,
  addDoc,
  closeDoc,
  createDocSet,
  isDocDirty,
  markDocSaved,
  parseDrafts,
  replaceDoc,
  serializeDrafts,
  setActive,
  updateText,
  type Doc,
  type DocSet,
} from '../lib/docSet'
import {
  judgeProbe,
  loadSession,
  mergeRestored,
  saveSession,
  toSession,
  type DiskState,
  type Session,
} from '../lib/docSession'
import { buildHtmlDocument } from '../lib/exportHtml'
import { downloadText, readHandle, statHandle } from '../lib/fileAccess'
import type { FileHandleLike, FileKind, OpenedFile } from '../lib/fileAccess'
import { offsetToPos } from '../lib/findReplace'
import { extractHeadings } from '../lib/outline'
import {
  FONT_DEFAULT,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  WIDTH_CH,
  clampSplit,
  cycleWidth,
  isWidthPref,
  stepFontSize,
  type WidthPref,
} from '../lib/readingPrefs'
import { readStored, writeStored } from '../lib/safeStorage'
import { computeStats } from '../lib/textStats'
import { el } from './dom'
import { createFindBar } from './findBar'
import { toast } from './toast'
import type { TabController } from './types'

const DRAFT_KEY = 'mdreadar:md-drafts'
const FONT_KEY = 'mdreadar:read-font'
const WIDTH_KEY = 'mdreadar:read-width'
const SPLIT_KEY = 'mdreadar:md-split'
const SPLIT_KEY_STEP = 2
const SIDE_EFFECT_DELAY_MS = 400
const DEFAULT_NAME = 'untitled.md'

const KIND: FileKind = {
  description: 'Markdown',
  mime: 'text/markdown',
  extensions: ['md', 'markdown', 'txt'],
}

const STARTER = `# QAReadar

เปิดไฟล์ \`.md\` ด้วยปุ่ม **Open** (หรือลากไฟล์มาวางในหน้านี้) แล้วแก้ไขได้ทันที

- ปุ่ม **Read & edit** เปลี่ยนเป็นมุมมองอ่านที่แก้ไขได้ในตัว (ไม่ต้องสลับกลับ)
- **Ctrl+K** เปิด command palette, **Ctrl+F / Ctrl+H** ค้นหา/แทนที่
- แท็บ **JSON Path** ใช้หา path ของค่าใน JSON

| feature | status |
| ------- | ------ |
| GFM table | ok |
| task list | ok |

- [x] เปิดไฟล์
- [ ] แก้ไขและบันทึก
`

let docSeq = 0
const makeDoc = (
  name: string,
  text: string,
  handle: FileHandleLike | null,
  savedText: string = text,
): Doc => ({ id: `doc${++docSeq}`, name, text, savedText, handle })

function printHtml(html: string): void {
  const frame = el('iframe', { 'aria-hidden': 'true', tabindex: '-1' })
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = html
  frame.addEventListener('load', () => {
    const win = frame.contentWindow
    if (!win) return
    win.addEventListener('afterprint', () => frame.remove())
    win.focus()
    win.print()
  })
  document.body.append(frame)
  window.setTimeout(() => frame.remove(), 120_000)
}

async function copyHtml(html: string, plain: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(html)
    }
    return true
  } catch {
    return false
  }
}

export function createMarkdownTab(): TabController {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const listeners: Array<() => void> = []

  // State is declared before the editor so early change events never hit a TDZ.
  /** Docs not worth remembering while clean and unlinked (starter, sample, blank new doc). */
  const ephemeral = new Set<string>()
  /** Docs restored from the legacy localStorage drafts; superseded by the IndexedDB session. */
  const legacy = new Set<string>()
  /** File lastModified when each doc was last read from / written to disk. */
  const stamps = new Map<string, number>()
  /** Docs whose file vanished from disk, or changed there since we read it. */
  const diskState = new Map<string, DiskState>()
  /** The stored session is written only after it has been read, so startup never clobbers it. */
  let hydrated = false
  let checking = false

  function restoreSet(): DocSet {
    const drafts = parseDrafts(readStored(DRAFT_KEY))
    if (drafts.length === 0) {
      const starter = makeDoc(DEFAULT_NAME, STARTER, null)
      ephemeral.add(starter.id)
      return createDocSet(starter)
    }
    const docs = drafts.map((d) => makeDoc(d.name, d.text, null, ''))
    docs.forEach((d) => legacy.add(d.id))
    return { docs, activeId: docs[0].id }
  }

  let set: DocSet = restoreSet()
  let loading = false
  let clean = false
  let sideTimer: number | undefined
  let fontSize = Number(readStored(FONT_KEY)) || FONT_DEFAULT
  const storedWidth = readStored(WIDTH_KEY)
  let width: WidthPref = isWidthPref(storedWidth) ? storedWidth : 'normal'
  let split = clampSplit(readStored(SPLIT_KEY))

  // ── chrome ──
  const outlineBtn = iconButton('outline', () => t('md.outline'), { variant: 'ghost', attrs: { 'aria-pressed': 'false' } })
  const findBtn = iconButton('search', () => t('md.find'), { variant: 'ghost', shortcut: 'Ctrl+F' })
  const cleanBtn = iconButton('book', '', { variant: 'ghost', text: ' ', attrs: { 'aria-pressed': 'false' } })
  const smallerBtn = iconButton('textSmaller', () => t('md.smaller'), { variant: 'ghost' })
  const largerBtn = iconButton('textLarger', () => t('md.larger'), { variant: 'ghost' })
  const widthBtn = iconButton('widthNormal', '', { variant: 'ghost' })
  const refreshBtn = iconButton('refresh', () => t('md.refresh'), { variant: 'ghost refresh-btn' })
  const WIDTH_ICONS: Record<WidthPref, IconName> = { narrow: 'widthNarrow', normal: 'widthNormal', wide: 'widthWide' }
  const diskWarnText = el('span', {})
  const diskWarn = el(
    'span',
    { class: 'disk-warn', role: 'status' },
    el('span', { class: 'disk-warn-dot', 'aria-hidden': 'true' }),
    diskWarnText,
  )
  const hint = el('span', { class: 'hint' })
  diskWarn.hidden = true
  const bar = el(
    'div',
    { class: 'pane-bar' },
    refreshBtn,
    diskWarn,
    el('span', { class: 'btn-group' }, outlineBtn, findBtn),
    cleanBtn,
    el('span', { class: 'btn-group' }, smallerBtn, largerBtn, widthBtn),
    hint,
  )
  const docStrip = el('div', { class: 'doc-tabs', role: 'tablist' })
  const outlineList = el('nav', { class: 'outline-list' })
  const outline = el('aside', { class: 'md-outline' }, outlineList)
  outline.hidden = true
  const host = el('div', { class: 'md-host' })
  const body = el('div', { class: 'md-body' }, outline, host)
  const status = el('footer', { class: 'md-status', role: 'status' })

  const editor = new Editor({
    el: host,
    height: '100%',
    initialEditType: 'markdown',
    previewStyle: 'vertical',
    initialValue: activeDoc(set).text,
    usageStatistics: false,
    theme: dark ? 'dark' : 'light',
    events: { change: handleChange },
  })

  const findBar = createFindBar({
    getText: () => editor.getMarkdown(),
    setText(text) {
      editor.setMarkdown(text, false)
      handleChange()
    },
    canSelect: () => editor.isMarkdownMode(),
    select(start, end) {
      const text = editor.getMarkdown()
      editor.setSelection(offsetToPos(text, start), offsetToPos(text, end))
    },
    findInView(query, options, backwards) {
      const win = window as unknown as {
        find?: (q: string, cs: boolean, back: boolean, wrap: boolean) => boolean
      }
      return win.find?.(query, options.caseSensitive, backwards, true) ?? false
    },
  })

  const element = el('section', { class: 'pane md-pane' }, bar, docStrip, findBar.element, body, status)

  // ── helpers ──
  const notify = (): void => listeners.forEach((listener) => listener())

  function applyPrefs(): void {
    element.style.setProperty('--read-size', `${fontSize}px`)
    element.style.setProperty('--read-width', WIDTH_CH[width])
    renderWidthBtn()
    writeStored(FONT_KEY, String(fontSize))
    writeStored(WIDTH_KEY, width)
  }

  function refreshOutline(): void {
    const headings = extractHeadings(editor.getMarkdown())
    if (headings.length === 0) {
      outlineList.replaceChildren(el('p', { class: 'hint' }, t('md.noHeadings')))
      return
    }
    outlineList.replaceChildren(
      ...headings.map((heading, index) => {
        const item = el('button', { class: `outline-item level-${heading.level}`, type: 'button' }, heading.text)
        item.addEventListener('click', () => jumpTo(heading.line, index))
        return item
      }),
    )
  }

  function jumpTo(line: number, index: number): void {
    if (editor.isMarkdownMode()) {
      editor.setSelection([line, 1], [line, 1])
      editor.focus()
      return
    }
    const rendered = host.querySelectorAll<HTMLElement>(
      '.toastui-editor-ww-container .ProseMirror :is(h1,h2,h3,h4,h5,h6)',
    )
    rendered[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function refreshStatus(): void {
    const stats = computeStats(editor.getMarkdown())
    const minutes = stats.minutes === 0 ? '' : t('md.minutes', { m: stats.minutes })
    status.textContent = t('md.stats', { words: stats.words, chars: stats.chars }) + minutes
  }

  const worthKeeping = (doc: Doc): boolean =>
    doc.handle !== null || isDocDirty(doc) || !ephemeral.has(doc.id)

  const sessionOf = (): Session | null =>
    toSession(set.docs.filter(worthKeeping), set.activeId, (id) => stamps.get(id))

  function persistDrafts(): void {
    // localStorage drafts stay as a synchronous fallback for unsaved edits.
    writeStored(DRAFT_KEY, set.docs.some(isDocDirty) ? serializeDrafts(set) : null)
    if (hydrated) void saveSession(sessionOf())
  }

  /** Restore the documents that were open last time — text first, links to disk second. */
  async function hydrate(): Promise<void> {
    const session = await loadSession()
    hydrated = true
    if (!session) {
      persistDrafts()
      return
    }
    // Keep anything the user opened or typed while the session was loading.
    const kept = set.docs.filter((d) => !legacy.has(d.id) && worthKeeping(d))
    const restored = session.docs.map((s) => {
      const doc = makeDoc(s.name, s.text, s.handle, s.savedText)
      if (s.stamp !== null) stamps.set(doc.id, s.stamp)
      return doc
    })
    set = mergeRestored(restored, session.activeIndex, kept, set.activeId)
    loadActive()
    void checkDisk()
  }

  /**
   * Background probe (no permission prompts): flag files that disappeared or were edited
   * elsewhere. Text in the app is never touched here.
   */
  async function checkDisk(): Promise<void> {
    if (checking) return
    checking = true
    try {
      let changed = false
      for (const doc of set.docs) {
        if (!doc.handle) continue
        const result = await statHandle(doc.handle)
        if (result === 'unknown') continue
        const before = diskState.get(doc.id)
        const { state: next, stamp } = judgeProbe(stamps.get(doc.id), result)
        if (stamp !== undefined) stamps.set(doc.id, stamp)
        if (next) diskState.set(doc.id, next)
        else diskState.delete(doc.id)
        changed ||= before !== next
      }
      if (changed) renderDocTabs()
    } finally {
      checking = false
    }
  }

  async function refreshFromDisk(): Promise<void> {
    const doc = activeDoc(set)
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
      diskState.set(doc.id, 'missing')
      renderDocTabs()
      toast(t('md.missing', { name: doc.name }), true)
      return
    }
    const current = activeDoc(set)
    if (current.id !== doc.id) return // user switched documents while we were reading
    if (isDocDirty(current) && !window.confirm(t('md.confirmReload', { name: current.name }))) {
      return
    }
    const before = editor.getMarkdown()
    const { file } = result
    if (file.lastModified !== undefined) stamps.set(doc.id, file.lastModified)
    diskState.delete(doc.id)
    set = replaceDoc(set, doc.id, { ...current, name: file.name, text: file.text, savedText: file.text })
    loadActive()
    toast(t(editor.getMarkdown() === before ? 'md.upToDate' : 'md.reloaded', { name: file.name }))
  }

  async function restamp(id: string, handle: FileHandleLike | null): Promise<void> {
    if (!handle) return
    const result = await statHandle(handle)
    if (typeof result === 'number') stamps.set(id, result)
    persistDrafts()
  }

  function renderDiskStatus(): void {
    const doc = activeDoc(set)
    const state = diskState.get(doc.id)
    diskWarn.hidden = state !== 'missing'
    refreshBtn.disabled = !doc.handle
    refreshBtn.classList.toggle('has-update', state === 'changed')
    refreshBtn.title = !doc.handle
      ? t('md.refreshNoFile')
      : state === 'changed'
        ? t('md.refreshChanged')
        : t('md.refreshTip')
  }

  function renderDocTabs(): void {
    renderDiskStatus()
    const addBtn = el('button', { class: 'doc-add', type: 'button', 'aria-label': t('md.newDoc'), title: t('md.newDoc') }, icon('plus', 14))
    addBtn.addEventListener('click', newDocument)
    docStrip.replaceChildren(
      ...set.docs.map((doc) => {
        const selected = doc.id === set.activeId
        const missing = diskState.get(doc.id) === 'missing'
        const tab = el(
          'button',
          {
            class: 'doc-tab',
            role: 'tab',
            type: 'button',
            'aria-selected': String(selected),
            title: missing ? t('md.docMissingTip', { name: doc.name }) : doc.name,
          },
          missing ? el('span', { class: 'disk-warn-dot', 'aria-label': t('md.docMissingDot') }) : '',
          isDocDirty(doc) ? '● ' : '',
          doc.name,
        )
        tab.addEventListener('click', () => switchTo(doc.id))
        const close = el('button', { class: 'doc-close', type: 'button', 'aria-label': t('md.closeDoc', { name: doc.name }), title: t('md.closeTip') }, icon('close', 12))
        close.addEventListener('click', () => closeById(doc.id))
        return el('span', { class: selected ? 'doc-item active' : 'doc-item' }, tab, close)
      }),
      addBtn,
    )
  }

  function scheduleSideEffects(): void {
    window.clearTimeout(sideTimer)
    sideTimer = window.setTimeout(() => {
      refreshOutline()
      refreshStatus()
      persistDrafts()
      renderDocTabs()
    }, SIDE_EFFECT_DELAY_MS)
  }

  function handleChange(): void {
    if (loading) return
    set = updateText(set, activeDoc(set).id, editor.getMarkdown())
    scheduleSideEffects()
    notify()
  }

  function loadActive(): void {
    const doc = activeDoc(set)
    const wasClean = !isDocDirty(doc)
    loading = true
    editor.setMarkdown(doc.text, false)
    loading = false
    // The editor may normalise whitespace; keep a clean document clean.
    const normalised = editor.getMarkdown()
    set = replaceDoc(set, doc.id, {
      ...doc,
      text: normalised,
      savedText: wasClean ? normalised : doc.savedText,
    })
    renderDocTabs()
    refreshOutline()
    refreshStatus()
    persistDrafts()
    notify()
  }

  function switchTo(id: string): void {
    if (id === set.activeId) return
    set = setActive(set, id)
    loadActive()
  }

  function newDocument(): void {
    const doc = makeDoc(DEFAULT_NAME, '', null)
    ephemeral.add(doc.id)
    set = addDoc(set, doc)
    loadActive()
    editor.focus()
  }

  function closeById(id: string): void {
    const doc = set.docs.find((d) => d.id === id)
    if (!doc) return
    if (isDocDirty(doc) && !window.confirm(t('md.confirmClose', { name: doc.name }))) return
    set = closeDoc(set, id, () => {
      const fresh = makeDoc(DEFAULT_NAME, '', null)
      ephemeral.add(fresh.id)
      return fresh
    })
    stamps.delete(id)
    diskState.delete(id)
    loadActive()
  }

  function setClean(on: boolean): void {
    clean = on
    element.classList.toggle('md-clean', on)
    cleanBtn.setAttribute('aria-pressed', String(on))
    renderCleanBtn()
    loading = true
    editor.changeMode(on ? 'wysiwyg' : 'markdown', true)
    loading = false
    if (on) {
      host.querySelector<HTMLElement>('.toastui-editor-ww-container .ProseMirror')?.focus()
    }
  }

  function setOutlineVisible(visible: boolean): void {
    outline.hidden = !visible
    outlineBtn.setAttribute('aria-pressed', String(visible))
    if (visible) refreshOutline()
  }

  function htmlDocument(): string {
    return buildHtmlDocument(activeDoc(set).name, editor.getHTML())
  }

  function exportHtml(): void {
    const name = activeDoc(set).name.replace(/\.[^.]+$/, '') || 'document'
    downloadText(`${name}.html`, htmlDocument(), 'text/html')
    toast(t('md.exported', { name: `${name}.html` }))
  }

  async function copyAsHtml(): Promise<void> {
    const ok = await copyHtml(editor.getHTML(), editor.getMarkdown())
    toast(ok ? t('md.copiedHtml') : t('msg.clipboard'), !ok)
  }

  function adjustFont(delta: number): void {
    fontSize = stepFontSize(fontSize, delta)
    applyPrefs()
  }

  function cycleColumnWidth(): void {
    width = cycleWidth(width)
    applyPrefs()
  }

  // ── Source view split (markdown | preview) ──
  // Toast UI renders a 1px splitter between the two halves; we turn it into a drag handle and
  // drive both widths from --md-split. A small button on the divider restores 50/50.
  const mdContainer = host.querySelector<HTMLElement>('.toastui-editor-md-container')
  const splitter = host.querySelector<HTMLElement>('.toastui-editor-md-splitter')
  const splitReset = el(
    'button',
    { class: 'md-split-reset', type: 'button' },
    '⇔',
  )

  function setSplit(next: number, persist = true): void {
    split = clampSplit(next)
    element.style.setProperty('--md-split', `${split}%`)
    splitReset.hidden = split === SPLIT_DEFAULT
    splitter?.setAttribute('aria-valuenow', String(Math.round(split)))
    if (persist) writeStored(SPLIT_KEY, String(split))
  }

  function resetSplit(): void {
    setSplit(SPLIT_DEFAULT)
  }

  if (mdContainer && splitter) {
    mdContainer.classList.add('md-split-host')
    mdContainer.append(splitReset)
    Object.assign(splitter, { tabIndex: 0 })
    splitter.setAttribute('role', 'separator')
    splitter.setAttribute('aria-orientation', 'vertical')
    splitter.setAttribute('aria-valuemin', String(SPLIT_MIN))
    splitter.setAttribute('aria-valuemax', String(SPLIT_MAX))

    splitter.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return
      ev.preventDefault()
      splitter.setPointerCapture(ev.pointerId)
      mdContainer.classList.add('md-split-dragging')
      const rect = mdContainer.getBoundingClientRect()
      const move = (e: PointerEvent): void => {
        if (rect.width > 0) setSplit(((e.clientX - rect.left) / rect.width) * 100, false)
      }
      const end = (): void => {
        splitter.removeEventListener('pointermove', move)
        mdContainer.classList.remove('md-split-dragging')
        writeStored(SPLIT_KEY, String(split))
      }
      splitter.addEventListener('pointermove', move)
      splitter.addEventListener('pointerup', end, { once: true })
      splitter.addEventListener('pointercancel', end, { once: true })
    })
    splitter.addEventListener('dblclick', resetSplit)
    splitter.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') setSplit(split - SPLIT_KEY_STEP)
      else if (ev.key === 'ArrowRight') setSplit(split + SPLIT_KEY_STEP)
      else if (ev.key === 'Home' || ev.key === 'Enter') resetSplit()
      else return
      ev.preventDefault()
    })
    splitReset.addEventListener('click', resetSplit)
  }
  setSplit(split, false)

  // ── wiring ──
  outlineBtn.addEventListener('click', () => setOutlineVisible(Boolean(outline.hidden)))
  findBtn.addEventListener('click', () => findBar.open(false))
  cleanBtn.addEventListener('click', () => setClean(!clean))
  smallerBtn.addEventListener('click', () => adjustFont(-1))
  largerBtn.addEventListener('click', () => adjustFont(1))
  widthBtn.addEventListener('click', cycleColumnWidth)
  refreshBtn.addEventListener('click', () => void refreshFromDisk().catch((e) => toast(String(e), true)))
  // Re-check files when the user comes back from another app (where they may have edited them).
  window.addEventListener('focus', () => void checkDisk())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkDisk()
  })
  // The debounced save may not have run yet: flush the latest text before the page goes away.
  window.addEventListener('pagehide', () => {
    window.clearTimeout(sideTimer)
    persistDrafts()
  })
  element.addEventListener(
    'keydown',
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return
      const key = ev.key.toLowerCase()
      if (key === 'f' || key === 'h') {
        ev.preventDefault()
        ev.stopPropagation()
        findBar.open(key === 'h')
      }
    },
    true,
  )

  function renderWidthBtn(): void {
    setIconButton(widthBtn, WIDTH_ICONS[width], t('md.width', { w: t(`width.${width}`) }))
  }

  function renderCleanBtn(): void {
    if (clean) setIconButton(cleanBtn, 'code', t('md.sourceTip'), t('md.source'))
    else setIconButton(cleanBtn, 'book', t('md.readEditTip'), t('md.readEdit'))
  }

  applyPrefs()
  loadActive()
  void hydrate()

  // Static chrome and every piece of rendered text follow the UI language.
  localized(() => {
    diskWarn.title = t('md.diskWarnTip')
    diskWarnText.textContent = t('md.diskWarn')
    hint.textContent = t('md.hint')
    docStrip.setAttribute('aria-label', t('md.docsAria'))
    outlineList.setAttribute('aria-label', t('md.outlineAria'))
    splitReset.title = t('md.splitReset')
    splitReset.setAttribute('aria-label', t('md.splitResetAria'))
    splitter?.setAttribute('aria-label', t('md.splitAria'))
    renderWidthBtn()
    renderCleanBtn()
    renderDocTabs()
    refreshStatus()
    if (!outline.hidden) refreshOutline()
  })

  const commands = (): Command[] => [
    { id: 'md.refresh', title: t('md.cmd.refresh'), run: () => void refreshFromDisk().catch((e) => toast(String(e), true)) },
    { id: 'md.clean', title: t('md.cmd.clean'), run: () => setClean(!clean) },
    { id: 'md.outline', title: t('md.cmd.outline'), run: () => setOutlineVisible(Boolean(outline.hidden)) },
    { id: 'md.find', title: t('md.cmd.find'), hint: 'Ctrl+F', run: () => findBar.open(false) },
    { id: 'md.replace', title: t('md.cmd.replace'), hint: 'Ctrl+H', run: () => findBar.open(true) },
    { id: 'md.new', title: t('md.cmd.new'), run: newDocument },
    { id: 'md.close', title: t('md.cmd.close'), run: () => closeById(set.activeId) },
    { id: 'md.export', title: t('md.cmd.export'), run: exportHtml },
    { id: 'md.copy', title: t('md.cmd.copy'), run: () => void copyAsHtml() },
    { id: 'md.print', title: t('md.cmd.print'), run: () => printHtml(htmlDocument()) },
    { id: 'md.bigger', title: t('md.cmd.bigger'), run: () => adjustFont(1) },
    { id: 'md.smaller', title: t('md.cmd.smaller'), run: () => adjustFont(-1) },
    { id: 'md.width', title: t('md.cmd.width'), run: cycleColumnWidth },
    { id: 'md.split-reset', title: t('md.cmd.split'), run: resetSplit },
  ]

  return {
    id: 'markdown',
    get label() {
      return t('tab.markdown')
    },
    kind: KIND,
    multiDoc: true,
    element,
    commands,
    setDark(isDark: boolean): void {
      host
        .querySelectorAll('.toastui-editor-defaultUI')
        .forEach((node) => node.classList.toggle('toastui-editor-dark', isDark))
    },
    open(file: OpenedFile): void {
      const doc = makeDoc(file.name, file.text, file.handle)
      if (file.sample) ephemeral.add(doc.id)
      if (file.handle && file.lastModified !== undefined) stamps.set(doc.id, file.lastModified)
      const current = activeDoc(set)
      const replaceable = !current.handle && !isDocDirty(current) && current.name === DEFAULT_NAME
      set = replaceable ? { ...replaceDoc(set, current.id, doc), activeId: doc.id } : addDoc(set, doc)
      loadActive()
    },
    snapshot() {
      const current = activeDoc(set)
      return { name: current.name, text: editor.getMarkdown(), handle: current.handle }
    },
    markSaved(savedName: string, savedHandle: FileHandleLike | null): void {
      const id = activeDoc(set).id
      const text = editor.getMarkdown()
      set = markDocSaved(updateText(set, id, text), id, savedName, savedHandle, text)
      // Our own write is not an "external change", and a saved file exists on disk again.
      diskState.delete(id)
      renderDocTabs()
      persistDrafts()
      void restamp(id, savedHandle)
      notify()
    },
    isDirty: () => set.docs.some(isDocDirty),
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
