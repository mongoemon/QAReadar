import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import type { Command } from '../lib/commands'
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
import { buildHtmlDocument } from '../lib/exportHtml'
import { downloadText } from '../lib/fileAccess'
import type { FileHandleLike, FileKind, OpenedFile } from '../lib/fileAccess'
import { offsetToPos } from '../lib/findReplace'
import { extractHeadings } from '../lib/outline'
import {
  FONT_DEFAULT,
  WIDTH_CH,
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

function restoreSet(): DocSet {
  const drafts = parseDrafts(readStored(DRAFT_KEY))
  if (drafts.length === 0) return createDocSet(makeDoc(DEFAULT_NAME, STARTER, null))
  const docs = drafts.map((d) => makeDoc(d.name, d.text, null, ''))
  return { docs, activeId: docs[0].id }
}

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
  let set: DocSet = restoreSet()
  let loading = false
  let clean = false
  let sideTimer: number | undefined
  let fontSize = Number(readStored(FONT_KEY)) || FONT_DEFAULT
  const storedWidth = readStored(WIDTH_KEY)
  let width: WidthPref = isWidthPref(storedWidth) ? storedWidth : 'normal'

  // ── chrome ──
  const outlineBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-pressed': 'false' }, 'Outline')
  const findBtn = el('button', { class: 'btn ghost', type: 'button' }, 'Find')
  const cleanBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-pressed': 'false' }, 'Read & edit')
  const smallerBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Smaller text' }, 'A−')
  const largerBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Larger text' }, 'A+')
  const widthBtn = el('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Column width' }, '')
  const bar = el(
    'div',
    { class: 'pane-bar' },
    outlineBtn,
    findBtn,
    cleanBtn,
    smallerBtn,
    largerBtn,
    widthBtn,
    el('span', { class: 'hint' }, 'Ctrl+K commands · Ctrl+F find · Ctrl+S save'),
  )
  const docStrip = el('div', { class: 'doc-tabs', role: 'tablist', 'aria-label': 'Open documents' })
  const outlineList = el('nav', { class: 'outline-list', 'aria-label': 'Document outline' })
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
    widthBtn.textContent = `Width: ${width}`
    writeStored(FONT_KEY, String(fontSize))
    writeStored(WIDTH_KEY, width)
  }

  function refreshOutline(): void {
    const headings = extractHeadings(editor.getMarkdown())
    if (headings.length === 0) {
      outlineList.replaceChildren(el('p', { class: 'hint' }, 'No headings yet'))
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
    const minutes = stats.minutes === 0 ? '' : ` · ~${stats.minutes} min read`
    status.textContent = `${stats.words} words · ${stats.chars} chars${minutes}`
  }

  function persistDrafts(): void {
    writeStored(DRAFT_KEY, set.docs.some(isDocDirty) ? serializeDrafts(set) : null)
  }

  function renderDocTabs(): void {
    const addBtn = el('button', { class: 'doc-add', type: 'button', 'aria-label': 'New document' }, '+')
    addBtn.addEventListener('click', newDocument)
    docStrip.replaceChildren(
      ...set.docs.map((doc) => {
        const selected = doc.id === set.activeId
        const tab = el(
          'button',
          { class: 'doc-tab', role: 'tab', type: 'button', 'aria-selected': String(selected), title: doc.name },
          isDocDirty(doc) ? '● ' : '',
          doc.name,
        )
        tab.addEventListener('click', () => switchTo(doc.id))
        const close = el('button', { class: 'doc-close', type: 'button', 'aria-label': `Close ${doc.name}` }, '×')
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
    set = addDoc(set, makeDoc(DEFAULT_NAME, '', null))
    loadActive()
    editor.focus()
  }

  function closeById(id: string): void {
    const doc = set.docs.find((d) => d.id === id)
    if (!doc) return
    if (isDocDirty(doc) && !window.confirm(`"${doc.name}" has unsaved changes. Close anyway?`)) return
    set = closeDoc(set, id, () => makeDoc(DEFAULT_NAME, '', null))
    loadActive()
  }

  function setClean(on: boolean): void {
    clean = on
    element.classList.toggle('md-clean', on)
    cleanBtn.setAttribute('aria-pressed', String(on))
    cleanBtn.textContent = on ? 'Source view' : 'Read & edit'
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
    toast(`Exported ${name}.html`)
  }

  async function copyAsHtml(): Promise<void> {
    const ok = await copyHtml(editor.getHTML(), editor.getMarkdown())
    toast(ok ? 'Copied as HTML' : 'Clipboard unavailable', !ok)
  }

  function adjustFont(delta: number): void {
    fontSize = stepFontSize(fontSize, delta)
    applyPrefs()
  }

  function cycleColumnWidth(): void {
    width = cycleWidth(width)
    applyPrefs()
  }

  // ── wiring ──
  outlineBtn.addEventListener('click', () => setOutlineVisible(Boolean(outline.hidden)))
  findBtn.addEventListener('click', () => findBar.open(false))
  cleanBtn.addEventListener('click', () => setClean(!clean))
  smallerBtn.addEventListener('click', () => adjustFont(-1))
  largerBtn.addEventListener('click', () => adjustFont(1))
  widthBtn.addEventListener('click', cycleColumnWidth)
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

  applyPrefs()
  loadActive()

  const commands = (): Command[] => [
    { id: 'md.clean', title: 'Markdown: Toggle Read & edit view', run: () => setClean(!clean) },
    { id: 'md.outline', title: 'Markdown: Toggle outline', run: () => setOutlineVisible(Boolean(outline.hidden)) },
    { id: 'md.find', title: 'Markdown: Find', hint: 'Ctrl+F', run: () => findBar.open(false) },
    { id: 'md.replace', title: 'Markdown: Find and replace', hint: 'Ctrl+H', run: () => findBar.open(true) },
    { id: 'md.new', title: 'Markdown: New document', run: newDocument },
    { id: 'md.close', title: 'Markdown: Close document', run: () => closeById(set.activeId) },
    { id: 'md.export', title: 'Markdown: Export as HTML', run: exportHtml },
    { id: 'md.copy', title: 'Markdown: Copy as HTML', run: () => void copyAsHtml() },
    { id: 'md.print', title: 'Markdown: Print / Save as PDF', run: () => printHtml(htmlDocument()) },
    { id: 'md.bigger', title: 'Markdown: Larger text', run: () => adjustFont(1) },
    { id: 'md.smaller', title: 'Markdown: Smaller text', run: () => adjustFont(-1) },
    { id: 'md.width', title: 'Markdown: Cycle column width', run: cycleColumnWidth },
  ]

  return {
    id: 'markdown',
    label: 'Markdown',
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
      renderDocTabs()
      persistDrafts()
      notify()
    },
    isDirty: () => set.docs.some(isDocDirty),
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
