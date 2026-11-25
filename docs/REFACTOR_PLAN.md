# แผน refactor: QAReadar (เริ่มจาก v1.6.0)

บันทึกเมื่อ 2026-11-25

## สถานะตั้งต้น

- test 412/412 ผ่าน, `tsc --noEmit` ผ่าน
- coverage แบบนับเฉพาะไฟล์ที่ test import = 92% แต่นับทุกไฟล์ใน `src/` เหลือ 35% (บรรทัด) โดย tab ทั้ง 5 และ `main.ts` เป็น 0%
- ฟังก์ชันใหญ่: `createTextPane` ~930, `createPdfTab` ~720, `createMarkdownTab` ~650, `createMergeTab` ~540 บรรทัด
- โค้ดซ้ำ: แถบเอกสาร เมนู การปิด/สลับเอกสาร และ `withKey` ของ Markdown กับ Text
- ไฟล์เกิน 800 บรรทัด: `ui/textTab.ts`, `ui/pdfTab.ts`, `lib/i18n.ts`, `style.css`

## ผลลัพธ์ (อัปเดต 2026-11-26)

เฟส 0–5 เสร็จครบแล้ว หลังจากนั้นเพิ่ม characterization test ให้ JSON Path และ Locator tab (`1fa8a8d`)

| ตัวชี้วัด | ตั้งต้น | ปัจจุบัน |
|---|---|---|
| test ที่ผ่าน | 412 | 577 (42 ไฟล์) |
| coverage บรรทัด (นับทุกไฟล์ใน `src/`) | 35% | 79.8% |
| coverage statements / branches / functions | ไม่ได้บันทึก | 77.2% / 72.9% / 74.2% |
| ไฟล์เกิน 800 บรรทัด | 4 | 0 |

`tsc --noEmit` และ `npm run build` ผ่าน (build ยังเตือนว่ามี chunk ใหญ่กว่า 500 kB)

| เฟส | commit |
|---|---|
| 0 | `5bdcc60` |
| 1 | `d45a95a` |
| 2 | `70a103c` |
| 3 | `e2de131` |
| 4 | `228f84a` |
| 5 | `a84e3d7` |

### ที่ยังเหลือ (นอกขอบเขตแผนนี้)

ฟังก์ชันใหญ่ที่ยังเกินเกณฑ์ 50 บรรทัดมาก ให้แตกเมื่อจะเพิ่มฟีเจอร์ใน tab นั้น:

| ฟังก์ชัน | ตั้งต้น (ประมาณ) | ปัจจุบัน (บรรทัด) |
|---|---|---|
| `createTextPane` | 930 | 498 |
| `createMarkdownTab` | 650 | 472 |
| `createMergeTab` | 540 | 374 |
| `createPdfTab` | 720 | 353 |
| `createJsonTab` | ไม่ได้บันทึก | 338 |

ไฟล์ที่ coverage บรรทัดยังต่ำกว่า 30%: `main.ts`, `lib/recentStore.ts`, `lib/samples.ts`, `ui/changelog.ts`, `ui/menu.ts`, `ui/palette.ts`, `ui/pdfEngine.ts`, `ui/pdfExportActions.ts`, `ui/shortcutsDialog.ts`, `ui/textareaScroll.ts`

การทดสอบมือตาม `REFACTOR_CHECKLIST.md` ยังไม่มีบันทึกผล

## ลำดับงาน (หนึ่งเฟสต่อหนึ่ง commit)

| เฟส | งาน | ความเสี่ยง |
|---|---|---|
| 0. ตาข่ายนิรภัย | `coverage.include` นับทุกไฟล์, characterization test ของ Text และ Markdown (เปิด ปิด สลับ ทำสำเนา save dirty), checklist ทดสอบมือ (`REFACTOR_CHECKLIST.md`) | ต่ำ |
| 1. ย้ายไฟล์ | i18n เป็น `lib/i18n/{index,en,th}.ts`, แยก CSS ตาม tab โดยรักษาลำดับ cascade | ต่ำ |
| 2. รวมโค้ดซ้ำ | `ui/docTabStrip.ts` ใช้ร่วมกัน, ย้าย logic "ปิดอันอื่น" และ "สลับเอกสาร" เข้า `lib/docSet.ts` พร้อม test | กลาง |
| 3. แยก Text tab | `ui/text/`: `splits`, `pane`, `columnSelect`, `editing`, `overlay` | กลางถึงสูง |
| 4. แยก PDF tab | `ui/pdf/`: `annotationLayer`, `gestures`, `thumbnails`, `viewport`, `actions` | สูง |
| 5. Markdown, Merge, main | แยกส่วนตรวจไฟล์บนดิสก์และ session, ส่วนวาด diff, drag-drop และ shortcut dispatcher | กลาง |

แนะนำให้ทำเฟส 0–2 ก่อน ส่วนเฟส 4 ทำตอนจะเพิ่มฟีเจอร์ PDF รอบถัดไป

## การตัดสินใจ

- ตอนรวมแถบเอกสาร (เฟส 2) ให้ Markdown ได้พฤติกรรมเดียวกับ Text: คลิกกลางเพื่อปิดเอกสาร และดับเบิลคลิกแถบว่างเพื่อสร้างใหม่ นี่เป็นการเปลี่ยนพฤติกรรมที่ตั้งใจ

## วิธีแตกฟังก์ชันใหญ่

ฟังก์ชันย่อยใช้ตัวแปรร่วมกันผ่าน closure แต่ละโมดูลที่แยกออกมาจึงต้องรับ interface เล็กๆ (`getText`, `replace`, `onChange`) แบบเดียวกับ `createCsvView` และย้ายทีละส่วน

## เกณฑ์ผ่านของทุกเฟส

- `npm test` และ `npm run build` ผ่าน
- พฤติกรรมเดิมไม่เปลี่ยน (ยกเว้นที่ระบุใน "การตัดสินใจ")
- ไฟล์ที่แตะไม่เกิน 800 บรรทัด

## สิ่งที่จะไม่ทำ

- ไม่เปลี่ยนชื่อ storage key (`mdreadar:` / `qareadar:`) เพราะ draft และการตั้งค่าของผู้ใช้จะหาย
- ไม่เพิ่ม framework หรือ dependency ใหม่ และไม่ใส่ฟีเจอร์ปนกับ refactor
- ไม่ไล่ให้ถึง 80% coverage ในรอบนี้ เขียน test เฉพาะส่วนที่กำลังจะแตะ
