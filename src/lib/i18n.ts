import { readStored, writeStored } from './safeStorage'

/**
 * UI localization (English / Thai). Technical terms — JSONPath, locator syntaxes, framework
 * names — stay in English in both languages on purpose: that is what testers search for.
 *
 * Language switches live: components register their text with `localized()` and it re-runs
 * on every change, so nothing typed into the app is lost by switching.
 */
export type Lang = 'en' | 'th'

export const LANGS: readonly Lang[] = ['en', 'th']
export const LANG_NAMES: Readonly<Record<Lang, string>> = { en: 'English', th: 'ไทย' }

const LANG_KEY = 'qareadar:lang'

const en = {
  // ── chrome ──
  'tabs.aria': 'Tools',
  'tab.markdown': 'Markdown',
  'tab.json': 'JSON Path',
  'tab.locator': 'Locator',
  'chip.unsaved': 'Unsaved changes',
  'top.open': 'Open file',
  'top.recent': 'Recent files',
  'top.save': 'Save',
  'top.saveAs': 'Save as…',
  'top.theme': 'Theme: {theme} — click to change',
  'theme.auto': 'auto',
  'theme.light': 'light',
  'theme.dark': 'dark',
  'top.focus': 'Hide UI (focus mode)',
  'top.command': 'Command palette',
  'top.lang': 'Language: English — switch to ไทย',
  'top.github': 'View on GitHub',
  'top.githubAria': 'QAReadar on GitHub',
  'version.title': 'Version {v} — hold 3 s for the changelog',
  'version.aria': 'Version {v}. Press and hold for 3 seconds to show the changelog',
  'zen.exit': 'Show UI (exit focus mode)',
  'msg.readDenied': 'Permission to read the file was denied',
  'msg.recentMissing': '{name} was not found on disk (moved or deleted)',
  'msg.unsupported': 'Unsupported file type: {name}',
  'msg.saved': 'Saved {name}',
  'msg.tooLarge': 'File is too large ({size} MB, max {max} MB)',
  'msg.clipboard': 'Clipboard unavailable',
  'confirm.replaceTab': 'This tab has unsaved changes. Replace them?',
  'cmd.open': 'File: Open…',
  'cmd.save': 'File: Save',
  'cmd.saveAs': 'File: Save as…',
  'cmd.goTab': 'Go to tab: {tab}',
  'cmd.theme': 'View: Change theme (auto / light / dark)',
  'cmd.focus': 'View: Hide UI / focus mode',
  'cmd.lang': 'View: Switch language (English / ไทย)',
  'cmd.changelog': 'Help: Changelog (v{v})',
  'cmd.recent': 'Recent: {name}',
  'palette.recentQuery': 'Recent',

  // ── command palette ──
  'palette.aria': 'Command palette',
  'palette.input': 'Command',
  'palette.placeholder': 'Type a command…',
  'palette.empty': 'No matching command',

  // ── changelog ──
  'cl.title': 'Changelog',
  'cl.close': 'Close changelog',
  'cl.current': 'current',
  'cl.added': 'Added',
  'cl.changed': 'Changed',
  'cl.fixed': 'Fixed',

  // ── find bar ──
  'find.aria': 'Find',
  'find.placeholder': 'Find…',
  'find.replaceAria': 'Replace with',
  'find.replacePlaceholder': 'Replace with…',
  'find.prev': 'Previous match',
  'find.next': 'Next match',
  'find.replaceOneTip': 'Replace this match',
  'find.replaceOne': 'Replace',
  'find.replaceAllTip': 'Replace all matches',
  'find.replaceAll': 'Replace all',
  'find.close': 'Close find',
  'find.case': 'Match case',
  'find.regex': 'Regular expression',
  'find.none': 'No matches',
  'find.sourceOnly': 'Switch to the Markdown source view to replace one at a time',
  'find.replaced': 'Replaced {n}',

  // ── markdown ──
  'md.outline': 'Outline',
  'md.find': 'Find & replace',
  'md.readEditTip': 'Read & edit view',
  'md.readEdit': 'Read & edit',
  'md.sourceTip': 'Back to source view',
  'md.source': 'Source view',
  'md.smaller': 'Smaller text',
  'md.larger': 'Larger text',
  'md.width': 'Column width: {w} — click to change',
  'width.narrow': 'narrow',
  'width.normal': 'normal',
  'width.wide': 'wide',
  'md.refresh': 'Refresh from disk',
  'md.refreshNoFile': 'Only documents opened from a file on disk can be refreshed',
  'md.refreshChanged': 'The file changed on disk — click to reload it',
  'md.refreshTip': 'Reload this document from its file on disk',
  'md.diskWarnTip': 'The file was moved, renamed or deleted. Your text is still here — use Save as to write it to a new file.',
  'md.diskWarn': 'File not found on disk',
  'md.hint': 'Ctrl+K commands · Ctrl+F find · Ctrl+. hide UI',
  'md.docsAria': 'Open documents',
  'md.outlineAria': 'Document outline',
  'md.noHeadings': 'No headings yet',
  'md.stats': '{words} words · {chars} chars',
  'md.minutes': ' · ~{m} min read',
  'md.notLinked': 'This document is not linked to a file on disk',
  'md.missing': '{name} was not found on disk — your text is kept in the app',
  'md.confirmReload': 'Discard unsaved changes to "{name}" and reload it from disk?',
  'md.upToDate': '{name} is already up to date',
  'md.reloaded': 'Reloaded {name} from disk',
  'md.docMissingTip': '{name} — file not found on disk (text kept)',
  'md.docMissingDot': 'File not found on disk',
  'md.newDoc': 'New document',
  'md.closeDoc': 'Close {name}',
  'md.closeTip': 'Close',
  'md.confirmClose': '"{name}" has unsaved changes. Close anyway?',
  'md.exported': 'Exported {name}',
  'md.copiedHtml': 'Copied as HTML',
  'md.splitAria': 'Resize markdown and preview (double-click to reset)',
  'md.splitReset': 'Reset to 50 / 50',
  'md.splitResetAria': 'Reset split to 50 / 50',
  'md.cmd.refresh': 'Markdown: Refresh from disk',
  'md.cmd.clean': 'Markdown: Toggle Read & edit view',
  'md.cmd.outline': 'Markdown: Toggle outline',
  'md.cmd.find': 'Markdown: Find',
  'md.cmd.replace': 'Markdown: Find and replace',
  'md.cmd.new': 'Markdown: New document',
  'md.cmd.close': 'Markdown: Close document',
  'md.cmd.export': 'Markdown: Export as HTML',
  'md.cmd.copy': 'Markdown: Copy as HTML',
  'md.cmd.print': 'Markdown: Print / Save as PDF',
  'md.cmd.bigger': 'Markdown: Larger text',
  'md.cmd.smaller': 'Markdown: Smaller text',
  'md.cmd.width': 'Markdown: Cycle column width',
  'md.cmd.split': 'Markdown: Reset source/preview split',

  // ── JSON ──
  'json.inputAria': 'JSON input',
  'json.placeholder': 'Paste JSON here, or open a .json / .jsonl / .csv / .yaml file…',
  'json.waiting': 'Waiting for JSON…',
  'json.gotoErrorTip': 'Jump to the error position',
  'json.gotoError': 'Go to error',
  'json.formatTip': 'Format (pretty-print)',
  'json.format': 'Format',
  'json.minify': 'Minify',
  'json.convertAria': 'Convert the text to JSON from…',
  'json.convertFrom': 'Convert from…',
  'json.searchPlaceholder': 'Search, or type a JSONPath like $.users[*].name',
  'json.searchAria': 'Search in JSON or run a JSONPath',
  'json.scopeAria': 'Search scope',
  'json.scopeAll': 'Keys + values',
  'json.scopeKey': 'Keys',
  'json.scopeValue': 'Values',
  'json.regexAria': 'Regular expression',
  'json.depthAria': 'Tree depth',
  'json.depthCollapsed': 'Collapsed',
  'json.depthN': 'Depth {n}',
  'json.depthAll': 'Expand all',
  'json.noSelection': 'No selection',
  'json.copyPath': 'Copy {label} path',
  'json.copiedPath': 'Copied {label} path',
  'json.clipboardPath': 'Clipboard unavailable — select the path and copy manually',
  'json.copyValueTip': 'Copy the selected value',
  'json.copyValue': 'Copy value',
  'json.matches': '{n} matches',
  'json.matchesMore': '{n} matches (showing {max})',
  'json.pathResult': '1 JSONPath result',
  'json.pathResults': '{n} JSONPath results',
  'json.truncated': ' (truncated)',
  'json.pattern': 'Pattern: {e}',
  'json.large': 'Large document ({n} nodes) — expanded to depth {d}',
  'json.invalid': 'Invalid JSON — {e}',
  'json.where': ' (line {line}, col {col})',
  'json.valid': 'Valid JSON',
  'json.fixFirst': 'Fix the JSON first — it does not parse yet',
  'json.cannotConvert': 'Cannot convert: {e}',
  'json.selectFirst': 'Select a node first',
  'json.copiedValue': 'Copied value',
  'json.converted': 'Converted {name} to JSON',
  'json.cmd.format': 'JSON: Format',
  'json.cmd.minify': 'JSON: Minify',
  'json.cmd.copyValue': 'JSON: Copy selected value',
  'json.cmd.search': 'JSON: Focus search / JSONPath',
  'json.cmd.convert': 'JSON: Convert text from {f}',

  // ── locator ──
  'loc.noSelection': 'Click an element in the preview',
  'loc.unique': 'unique',
  'loc.matches': '{n} matches',
  'loc.unmeasured': 'Could not be measured in this preview',
  'loc.matchesTip1': 'Matches 1 element in this page',
  'loc.matchesTipN': 'Matches {n} elements in this page',
  'loc.copy': 'Copy {label} locator',
  'loc.copied': 'Copied {label} locator',
  'loc.clipboard': 'Clipboard unavailable — select the locator and copy manually',
  'loc.sourceAria': 'Page HTML source',
  'loc.placeholder': 'Paste the HTML source of a page here (or open a .html file), then click an element in the preview…',
  'loc.syntaxAria': 'Locator syntax',
  'loc.docs': 'Docs',
  'loc.docsTip': 'Open the official {f} locator docs',
  'loc.companionTip': 'Open the {lib} docs — the basic library used with {f}',
  'loc.parentTip': 'Select the parent element',
  'loc.parent': 'Parent',
  'loc.sourceHint': 'HTML source — click a tag or its text to see the locators',
  'loc.for': 'Locators for',
  'loc.noParent': 'No parent element to select',
  'loc.previewTitle': 'Page preview',
  'loc.cmd.framework': 'Locator: Show {f} locators',
  'loc.cmd.parent': 'Locator: Select parent element',
} as const

export type MessageKey = keyof typeof en

const th: Readonly<Record<MessageKey, string>> = {
  // ── chrome ──
  'tabs.aria': 'เครื่องมือ',
  'tab.markdown': 'Markdown',
  'tab.json': 'JSON Path',
  'tab.locator': 'Locator',
  'chip.unsaved': 'มีการแก้ไขที่ยังไม่บันทึก',
  'top.open': 'เปิดไฟล์',
  'top.recent': 'ไฟล์ล่าสุด',
  'top.save': 'บันทึก',
  'top.saveAs': 'บันทึกเป็น…',
  'top.theme': 'ธีม: {theme} — คลิกเพื่อเปลี่ยน',
  'theme.auto': 'อัตโนมัติ',
  'theme.light': 'สว่าง',
  'theme.dark': 'มืด',
  'top.focus': 'ซ่อน UI (โหมดโฟกัส)',
  'top.command': 'แผงคำสั่ง',
  'top.lang': 'ภาษา: ไทย — switch to English',
  'top.github': 'ดูบน GitHub',
  'top.githubAria': 'QAReadar บน GitHub',
  'version.title': 'เวอร์ชัน {v} — กดค้าง 3 วินาทีเพื่อดูบันทึกการเปลี่ยนแปลง',
  'version.aria': 'เวอร์ชัน {v} กดค้าง 3 วินาทีเพื่อแสดงบันทึกการเปลี่ยนแปลง',
  'zen.exit': 'แสดง UI (ออกจากโหมดโฟกัส)',
  'msg.readDenied': 'ไม่ได้รับสิทธิ์ให้อ่านไฟล์',
  'msg.recentMissing': 'ไม่พบ {name} บนดิสก์ (ถูกย้ายหรือลบไปแล้ว)',
  'msg.unsupported': 'ไม่รองรับไฟล์ประเภทนี้: {name}',
  'msg.saved': 'บันทึก {name} แล้ว',
  'msg.tooLarge': 'ไฟล์ใหญ่เกินไป ({size} MB, สูงสุด {max} MB)',
  'msg.clipboard': 'ใช้คลิปบอร์ดไม่ได้',
  'confirm.replaceTab': 'แท็บนี้มีการแก้ไขที่ยังไม่บันทึก ต้องการแทนที่หรือไม่?',
  'cmd.open': 'ไฟล์: เปิด…',
  'cmd.save': 'ไฟล์: บันทึก',
  'cmd.saveAs': 'ไฟล์: บันทึกเป็น…',
  'cmd.goTab': 'ไปที่แท็บ: {tab}',
  'cmd.theme': 'มุมมอง: เปลี่ยนธีม (อัตโนมัติ / สว่าง / มืด)',
  'cmd.focus': 'มุมมอง: ซ่อน UI / โหมดโฟกัส',
  'cmd.lang': 'มุมมอง: สลับภาษา (English / ไทย)',
  'cmd.changelog': 'ช่วยเหลือ: บันทึกการเปลี่ยนแปลง (v{v})',
  'cmd.recent': 'ล่าสุด: {name}',
  'palette.recentQuery': 'ล่าสุด',

  // ── command palette ──
  'palette.aria': 'แผงคำสั่ง',
  'palette.input': 'คำสั่ง',
  'palette.placeholder': 'พิมพ์คำสั่ง…',
  'palette.empty': 'ไม่พบคำสั่งที่ตรงกัน',

  // ── changelog ──
  'cl.title': 'บันทึกการเปลี่ยนแปลง',
  'cl.close': 'ปิดบันทึกการเปลี่ยนแปลง',
  'cl.current': 'ปัจจุบัน',
  'cl.added': 'เพิ่ม',
  'cl.changed': 'เปลี่ยน',
  'cl.fixed': 'แก้ไข',

  // ── find bar ──
  'find.aria': 'ค้นหา',
  'find.placeholder': 'ค้นหา…',
  'find.replaceAria': 'แทนที่ด้วย',
  'find.replacePlaceholder': 'แทนที่ด้วย…',
  'find.prev': 'รายการก่อนหน้า',
  'find.next': 'รายการถัดไป',
  'find.replaceOneTip': 'แทนที่รายการนี้',
  'find.replaceOne': 'แทนที่',
  'find.replaceAllTip': 'แทนที่ทุกรายการ',
  'find.replaceAll': 'แทนที่ทั้งหมด',
  'find.close': 'ปิดการค้นหา',
  'find.case': 'ตรงตัวพิมพ์เล็ก-ใหญ่',
  'find.regex': 'Regular expression',
  'find.none': 'ไม่พบ',
  'find.sourceOnly': 'สลับไปมุมมอง source ของ Markdown เพื่อแทนที่ทีละรายการ',
  'find.replaced': 'แทนที่แล้ว {n} รายการ',

  // ── markdown ──
  'md.outline': 'สารบัญ',
  'md.find': 'ค้นหาและแทนที่',
  'md.readEditTip': 'มุมมองอ่านและแก้ไข',
  'md.readEdit': 'อ่านและแก้ไข',
  'md.sourceTip': 'กลับไปมุมมอง source',
  'md.source': 'มุมมอง source',
  'md.smaller': 'ตัวอักษรเล็กลง',
  'md.larger': 'ตัวอักษรใหญ่ขึ้น',
  'md.width': 'ความกว้างคอลัมน์: {w} — คลิกเพื่อเปลี่ยน',
  'width.narrow': 'แคบ',
  'width.normal': 'ปกติ',
  'width.wide': 'กว้าง',
  'md.refresh': 'โหลดใหม่จากดิสก์',
  'md.refreshNoFile': 'โหลดใหม่ได้เฉพาะเอกสารที่เปิดจากไฟล์บนดิสก์',
  'md.refreshChanged': 'ไฟล์บนดิสก์มีการเปลี่ยนแปลง — คลิกเพื่อโหลดใหม่',
  'md.refreshTip': 'โหลดเอกสารนี้ใหม่จากไฟล์บนดิสก์',
  'md.diskWarnTip': 'ไฟล์ถูกย้าย เปลี่ยนชื่อ หรือลบไปแล้ว ข้อความของคุณยังอยู่ — ใช้ "บันทึกเป็น" เพื่อเขียนลงไฟล์ใหม่',
  'md.diskWarn': 'ไม่พบไฟล์บนดิสก์',
  'md.hint': 'Ctrl+K คำสั่ง · Ctrl+F ค้นหา · Ctrl+. ซ่อน UI',
  'md.docsAria': 'เอกสารที่เปิดอยู่',
  'md.outlineAria': 'สารบัญเอกสาร',
  'md.noHeadings': 'ยังไม่มีหัวข้อ',
  'md.stats': '{words} คำ · {chars} ตัวอักษร',
  'md.minutes': ' · อ่าน ~{m} นาที',
  'md.notLinked': 'เอกสารนี้ไม่ได้เชื่อมกับไฟล์บนดิสก์',
  'md.missing': 'ไม่พบ {name} บนดิสก์ — ข้อความยังเก็บไว้ในแอป',
  'md.confirmReload': 'ทิ้งการแก้ไขที่ยังไม่บันทึกของ "{name}" แล้วโหลดใหม่จากดิสก์หรือไม่?',
  'md.upToDate': '{name} เป็นเวอร์ชันล่าสุดอยู่แล้ว',
  'md.reloaded': 'โหลด {name} ใหม่จากดิสก์แล้ว',
  'md.docMissingTip': '{name} — ไม่พบไฟล์บนดิสก์ (ข้อความยังอยู่)',
  'md.docMissingDot': 'ไม่พบไฟล์บนดิสก์',
  'md.newDoc': 'เอกสารใหม่',
  'md.closeDoc': 'ปิด {name}',
  'md.closeTip': 'ปิด',
  'md.confirmClose': '"{name}" มีการแก้ไขที่ยังไม่บันทึก ปิดเลยหรือไม่?',
  'md.exported': 'ส่งออก {name} แล้ว',
  'md.copiedHtml': 'คัดลอกเป็น HTML แล้ว',
  'md.splitAria': 'ปรับขนาด Markdown และ Preview (ดับเบิลคลิกเพื่อรีเซ็ต)',
  'md.splitReset': 'รีเซ็ตเป็น 50 / 50',
  'md.splitResetAria': 'รีเซ็ตการแบ่งเป็น 50 / 50',
  'md.cmd.refresh': 'Markdown: โหลดใหม่จากดิสก์',
  'md.cmd.clean': 'Markdown: สลับมุมมองอ่านและแก้ไข',
  'md.cmd.outline': 'Markdown: เปิด/ปิดสารบัญ',
  'md.cmd.find': 'Markdown: ค้นหา',
  'md.cmd.replace': 'Markdown: ค้นหาและแทนที่',
  'md.cmd.new': 'Markdown: เอกสารใหม่',
  'md.cmd.close': 'Markdown: ปิดเอกสาร',
  'md.cmd.export': 'Markdown: ส่งออกเป็น HTML',
  'md.cmd.copy': 'Markdown: คัดลอกเป็น HTML',
  'md.cmd.print': 'Markdown: พิมพ์ / บันทึกเป็น PDF',
  'md.cmd.bigger': 'Markdown: ตัวอักษรใหญ่ขึ้น',
  'md.cmd.smaller': 'Markdown: ตัวอักษรเล็กลง',
  'md.cmd.width': 'Markdown: เปลี่ยนความกว้างคอลัมน์',
  'md.cmd.split': 'Markdown: รีเซ็ตการแบ่ง source/preview',

  // ── JSON ──
  'json.inputAria': 'ช่องใส่ JSON',
  'json.placeholder': 'วาง JSON ที่นี่ หรือเปิดไฟล์ .json / .jsonl / .csv / .yaml…',
  'json.waiting': 'รอ JSON…',
  'json.gotoErrorTip': 'ไปยังตำแหน่งที่ผิดพลาด',
  'json.gotoError': 'ไปที่จุดผิดพลาด',
  'json.formatTip': 'จัดรูปแบบ (pretty-print)',
  'json.format': 'จัดรูปแบบ',
  'json.minify': 'บีบอัด',
  'json.convertAria': 'แปลงข้อความเป็น JSON จาก…',
  'json.convertFrom': 'แปลงจาก…',
  'json.searchPlaceholder': 'ค้นหา หรือพิมพ์ JSONPath เช่น $.users[*].name',
  'json.searchAria': 'ค้นหาใน JSON หรือรัน JSONPath',
  'json.scopeAria': 'ขอบเขตการค้นหา',
  'json.scopeAll': 'คีย์ + ค่า',
  'json.scopeKey': 'คีย์',
  'json.scopeValue': 'ค่า',
  'json.regexAria': 'Regular expression',
  'json.depthAria': 'ความลึกของ tree',
  'json.depthCollapsed': 'ยุบทั้งหมด',
  'json.depthN': 'ลึก {n} ชั้น',
  'json.depthAll': 'ขยายทั้งหมด',
  'json.noSelection': 'ยังไม่ได้เลือก',
  'json.copyPath': 'คัดลอก path แบบ {label}',
  'json.copiedPath': 'คัดลอก path แบบ {label} แล้ว',
  'json.clipboardPath': 'ใช้คลิปบอร์ดไม่ได้ — เลือก path แล้วคัดลอกเอง',
  'json.copyValueTip': 'คัดลอกค่าที่เลือก',
  'json.copyValue': 'คัดลอกค่า',
  'json.matches': 'พบ {n} รายการ',
  'json.matchesMore': 'พบ {n} รายการ (แสดง {max})',
  'json.pathResult': 'ผลลัพธ์ JSONPath 1 รายการ',
  'json.pathResults': 'ผลลัพธ์ JSONPath {n} รายการ',
  'json.truncated': ' (ถูกตัดทอน)',
  'json.pattern': 'รูปแบบ: {e}',
  'json.large': 'เอกสารใหญ่ ({n} โหนด) — ขยายถึงความลึก {d}',
  'json.invalid': 'JSON ไม่ถูกต้อง — {e}',
  'json.where': ' (บรรทัด {line}, คอลัมน์ {col})',
  'json.valid': 'JSON ถูกต้อง',
  'json.fixFirst': 'แก้ JSON ให้ถูกต้องก่อน — ตอนนี้ยัง parse ไม่ได้',
  'json.cannotConvert': 'แปลงไม่ได้: {e}',
  'json.selectFirst': 'เลือกโหนดก่อน',
  'json.copiedValue': 'คัดลอกค่าแล้ว',
  'json.converted': 'แปลง {name} เป็น JSON แล้ว',
  'json.cmd.format': 'JSON: จัดรูปแบบ',
  'json.cmd.minify': 'JSON: บีบอัด',
  'json.cmd.copyValue': 'JSON: คัดลอกค่าที่เลือก',
  'json.cmd.search': 'JSON: ไปที่ช่องค้นหา / JSONPath',
  'json.cmd.convert': 'JSON: แปลงข้อความจาก {f}',

  // ── locator ──
  'loc.noSelection': 'คลิก element ใน preview',
  'loc.unique': 'ไม่ซ้ำ',
  'loc.matches': 'ตรง {n} ตัว',
  'loc.unmeasured': 'วัดผลใน preview นี้ไม่ได้',
  'loc.matchesTip1': 'ตรงกับ 1 element ในหน้านี้',
  'loc.matchesTipN': 'ตรงกับ {n} element ในหน้านี้',
  'loc.copy': 'คัดลอก locator แบบ {label}',
  'loc.copied': 'คัดลอก locator แบบ {label} แล้ว',
  'loc.clipboard': 'ใช้คลิปบอร์ดไม่ได้ — เลือก locator แล้วคัดลอกเอง',
  'loc.sourceAria': 'HTML source ของหน้าเว็บ',
  'loc.placeholder': 'วาง HTML source ของหน้าเว็บที่นี่ (หรือเปิดไฟล์ .html) แล้วคลิก element ใน preview…',
  'loc.syntaxAria': 'รูปแบบ locator',
  'loc.docs': 'เอกสาร',
  'loc.docsTip': 'เปิดเอกสาร locator ทางการของ {f}',
  'loc.companionTip': 'เปิดเอกสาร {lib} — library พื้นฐานที่ใช้คู่กับ {f}',
  'loc.parentTip': 'เลือก element แม่',
  'loc.parent': 'ตัวแม่',
  'loc.sourceHint': 'HTML source — คลิกที่ tag หรือข้อความเพื่อดู locator',
  'loc.for': 'Locator สำหรับ',
  'loc.noParent': 'ไม่มี element แม่ให้เลือก',
  'loc.previewTitle': 'ตัวอย่างหน้าเว็บ',
  'loc.cmd.framework': 'Locator: แสดงแบบ {f}',
  'loc.cmd.parent': 'Locator: เลือก element แม่',
}

export const MESSAGES: Readonly<Record<Lang, Readonly<Record<MessageKey, string>>>> = { en, th }

export const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang)

/** Stored choice first, then the browser's preferred languages, then English. */
export function detectLang(stored: string | null, preferred: readonly string[]): Lang {
  if (isLang(stored)) return stored
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}

export type Vars = Readonly<Record<string, string | number>>

export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

const browserLangs = (): readonly string[] =>
  typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language ?? '']

let current: Lang = detectLang(readStored(LANG_KEY), browserLangs())
const listeners = new Set<() => void>()

export const getLang = (): Lang => current

export function t(key: MessageKey, vars?: Vars): string {
  return format(MESSAGES[current][key] ?? en[key], vars)
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  writeStored(LANG_KEY, lang)
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const listener of [...listeners]) listener()
}

export const nextLang = (lang: Lang): Lang => LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]

/** Run `update` now and again after every language change. For long-lived UI only. */
export function localized(update: () => void): () => void {
  update()
  listeners.add(update)
  return () => listeners.delete(update)
}

if (typeof document !== 'undefined') document.documentElement.lang = current
