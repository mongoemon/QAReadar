import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import type { Command } from '../lib/commands'
import { localized, t } from '../lib/i18n'
import { iconButton, setIconButton, type IconName } from './icons'
import {
  activeDoc,
  addDoc,
  closeDoc,
  copyName,
  insertDocAfter,
  isDocDirty,
  keepOnly,
  markDocSaved,
  otherDocs,
  replaceDoc,
  setActive,
  steppedId,
  updateText,
  type Doc,
  type DocSet,
} from '../lib/docSet'
import { buildHtmlDocument } from '../lib/exportHtml'
import { downloadText } from '../lib/fileAccess'
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
import { keyHint, shortcutLabel, withShortcuts } from '../lib/shortcuts'
import { computeStats } from '../lib/textStats'
import { createDocTabStrip } from './docTabStrip'
import { el } from './dom'
import { createFindBar } from './findBar'
import { createDiskSync } from './markdown/diskSync'
import { createMarkdownSession } from './markdown/session'
import { toast } from './toast'
import type { TabController } from './types'

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
  const session = createMarkdownSession({
    defaultName: DEFAULT_NAME,
    makeDoc,
    getSet: () => set,
    setSet(next) {
      set = next
    },
    stampOf: (id) => disk.stampOf(id),
    setStamp: (id, stamp) => disk.setStamp(id, stamp),
    restored() {
      loadActive()
      void disk.check()
    },
  })
  const disk = createDiskSync({
    getSet: () => set,
    setSet(next) {
      set = next
    },
    editorText: () => editor.getMarkdown(),
    show: () => loadActive(),
    renderTabs: () => renderDocTabs(),
    persist: session.persist,
  })

  let set: DocSet = session.initialSet()
  let loading = false
  let clean = false
  let sideTimer: number | undefined
  let fontSize = Number(readStored(FONT_KEY)) || FONT_DEFAULT
  const storedWidth = readStored(WIDTH_KEY)
  let width: WidthPref = isWidthPref(storedWidth) ? storedWidth : 'normal'
  let split = clampSplit(readStored(SPLIT_KEY))

  // ── chrome ──
  const outlineBtn = iconButton('outline', () => t('md.outline'), { variant: 'ghost', attrs: { 'aria-pressed': 'false' } })
  const findBtn = iconButton('search', () => t('md.find'), { variant: 'ghost', shortcut: () => shortcutLabel('md.find') })
  const cleanBtn = iconButton('book', '', { variant: 'ghost', text: ' ', attrs: { 'aria-pressed': 'false' } })
  const smallerBtn = iconButton('textSmaller', () => t('md.smaller'), { variant: 'ghost' })
  const largerBtn = iconButton('textLarger', () => t('md.larger'), { variant: 'ghost' })
  const widthBtn = iconButton('widthNormal', '', { variant: 'ghost' })
  const WIDTH_ICONS: Record<WidthPref, IconName> = { narrow: 'widthNarrow', normal: 'widthNormal', wide: 'widthWide' }
  const hint = el('span', { class: 'hint' })
  const bar = el(
    'div',
    { class: 'pane-bar' },
    disk.refreshButton,
    disk.warning,
    el('span', { class: 'btn-group' }, outlineBtn, findBtn),
    cleanBtn,
    el('span', { class: 'btn-group' }, smallerBtn, largerBtn, widthBtn),
    hint,
  )
  const docStrip = createDocTabStrip({
    commands: { newDoc: 'md.new', duplicate: 'md.duplicate', close: 'md.close' },
    getSet: () => set,
    newDocument,
    switchTo,
    duplicate: duplicateById,
    close: closeById,
    closeOthers,
    decorate: (doc) =>
      disk.isMissing(doc.id)
        ? {
            mark: el('span', { class: 'disk-warn-dot', 'aria-label': t('md.docMissingDot') }),
            title: t('md.docMissingTip', { name: doc.name }),
          }
        : null,
  })
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

  const element = el('section', { class: 'pane md-pane' }, bar, docStrip.element, findBar.element, body, status)

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

  function renderDocTabs(): void {
    disk.render()
    docStrip.render()
  }

  function scheduleSideEffects(): void {
    window.clearTimeout(sideTimer)
    sideTimer = window.setTimeout(() => {
      refreshOutline()
      refreshStatus()
      session.persist()
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
    session.persist()
    notify()
  }

  function switchTo(id: string): void {
    if (id === set.activeId) return
    set = setActive(set, id)
    loadActive()
  }

  function newDocument(): void {
    set = addDoc(set, session.blankDoc())
    loadActive()
    editor.focus()
  }

  function duplicateById(id: string): void {
    const source = set.docs.find((d) => d.id === id)
    if (!source) return
    // Take the live editor text for the active doc (the debounced update may not have run yet).
    const text = id === set.activeId ? editor.getMarkdown() : source.text
    // A copy is a new, unsaved document: no file link, so Save asks where to put it.
    const copy = makeDoc(copyName(source.name, set.docs.map((d) => d.name)), text, null, '')
    set = insertDocAfter(set, id, copy)
    loadActive()
    editor.focus()
  }

  function closeOthers(id: string): void {
    const others = otherDocs(set, id)
    const dirty = others.filter(isDocDirty)
    if (dirty.length > 0 && !window.confirm(t('md.confirmCloseOthers', { n: dirty.length }))) return
    for (const doc of others) disk.forget(doc.id)
    set = keepOnly(set, id)
    loadActive()
  }

  /** Move to the next (+1) or previous (-1) document tab, wrapping around. */
  function cycleDoc(step: number): void {
    switchTo(steppedId(set, step))
  }

  function closeById(id: string): void {
    const doc = set.docs.find((d) => d.id === id)
    if (!doc) return
    if (isDocDirty(doc) && !window.confirm(t('md.confirmClose', { name: doc.name }))) return
    set = closeDoc(set, id, session.blankDoc)
    disk.forget(id)
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
  // The debounced save may not have run yet: flush the latest text before the page goes away.
  window.addEventListener('pagehide', () => {
    window.clearTimeout(sideTimer)
    session.persist()
  })

  function renderWidthBtn(): void {
    setIconButton(widthBtn, WIDTH_ICONS[width], t('md.width', { w: t(`width.${width}`) }))
  }

  function renderCleanBtn(): void {
    if (clean) setIconButton(cleanBtn, 'code', t('md.sourceTip'), t('md.source'))
    else setIconButton(cleanBtn, 'book', t('md.readEditTip'), t('md.readEdit'))
  }

  /** Keys in the hint follow the platform (⌘ on a Mac) and any rebinding. */
  function renderHint(): void {
    hint.textContent = t('md.hint', { palette: keyHint('view.palette'), find: keyHint('md.find'), focus: keyHint('view.focus') })
  }

  applyPrefs()
  loadActive()
  void session.hydrate()
  // Tab tooltips and the hint show the current shortcuts.
  withShortcuts(renderDocTabs)
  withShortcuts(renderHint)

  // Static chrome and every piece of rendered text follow the UI language.
  localized(() => {
    disk.localize()
    renderHint()
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
    { id: 'md.refresh', title: t('md.cmd.refresh'), run: disk.refresh },
    { id: 'md.clean', title: t('md.cmd.clean'), run: () => setClean(!clean) },
    { id: 'md.outline', title: t('md.cmd.outline'), run: () => setOutlineVisible(Boolean(outline.hidden)) },
    { id: 'md.find', title: t('md.cmd.find'), run: () => findBar.open(false) },
    { id: 'md.replace', title: t('md.cmd.replace'), run: () => findBar.open(true) },
    { id: 'md.new', title: t('md.cmd.new'), run: newDocument },
    { id: 'md.duplicate', title: t('md.cmd.duplicate'), run: () => duplicateById(set.activeId) },
    { id: 'md.close', title: t('md.cmd.close'), run: () => closeById(set.activeId) },
    { id: 'md.nextDoc', title: t('md.cmd.nextDoc'), run: () => cycleDoc(1) },
    { id: 'md.prevDoc', title: t('md.cmd.prevDoc'), run: () => cycleDoc(-1) },
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
      if (file.sample) {
        // The same sample opened again (and untouched): just bring its tab forward.
        const existing = set.docs.find((d) => session.isEphemeral(d.id) && !d.handle && !isDocDirty(d) && d.name === file.name)
        if (existing) {
          switchTo(existing.id)
          return
        }
      }
      const doc = makeDoc(file.name, file.text, file.handle)
      if (file.sample) session.markEphemeral(doc.id)
      if (file.handle && file.lastModified !== undefined) disk.setStamp(doc.id, file.lastModified)
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
      disk.saved(id)
      renderDocTabs()
      session.persist()
      void disk.restamp(id, savedHandle)
      notify()
    },
    isDirty: () => set.docs.some(isDocDirty),
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
