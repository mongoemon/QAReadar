# QAReadar

เว็บแอปฝั่ง client ล้วน (ไม่มี backend) สำหรับ **แก้ไขไฟล์ Markdown**, **หา path ของค่าใน JSON** และ **หา locator ขององค์ประกอบในหน้า HTML** (Playwright / Robot Framework)
ไฟล์ทั้งหมดอยู่ในเบราว์เซอร์ของคุณ ไม่มีการอัปโหลดไปไหน

## เริ่มใช้งาน

```bash
npm install
npm run dev        # เปิด dev server
npm test           # unit tests (vitest)
npm run build      # type-check + build ไปที่ dist/
npm run preview    # ลองไฟล์ที่ build แล้ว
```

Build ใช้ `base: './'` จึงนำ `dist/` ไปวางบน static host ที่ sub-path ใดก็ได้

## ฟีเจอร์

### Markdown
- **Editor สองโหมด**: Markdown source พร้อม preview แบบ split และ WYSIWYG (ใช้ [Toast UI Editor](https://github.com/nhn/tui.editor), รองรับ GFM table และ task list)
- **Read & edit**: มุมมองอ่านแบบสะอาด (ซ่อน toolbar) ที่ **แก้ไขได้ในตัว** ไม่ต้องสลับกลับไปโหมด Edit
- **ปรับการอ่าน**: ขนาดตัวอักษร (A− / A+) และความกว้างคอลัมน์ (narrow / normal / wide) จำค่าไว้ให้
- **หลายเอกสาร**: เปิดหลายไฟล์พร้อมกันเป็นแท็บ มีจุด ● บอกว่ายังไม่บันทึก และเตือนก่อนปิดแท็บที่ยังไม่บันทึก
- **Outline**: สารบัญหัวข้อ คลิกเพื่อกระโดดไปหัวข้อนั้น (ไม่นับ `#` ที่อยู่ใน code block)
- **ค้นหา / แทนที่** (`Ctrl+F` / `Ctrl+H`): รองรับ regex, case-sensitive, Replace all และ `$1` / `$&` ในโหมด regex
  - Replace ทีละจุดใช้ได้เฉพาะใน Markdown source view
- **สถิติ**: จำนวนคำ ตัวอักษร และเวลาอ่านโดยประมาณ (นับคำไทยด้วย `Intl.Segmenter`)
- **Export**: บันทึกเป็น HTML, คัดลอกเป็น HTML, พิมพ์ / บันทึกเป็น PDF (ผ่าน command palette)
- **Draft อัตโนมัติ**: เก็บเอกสารที่ยังไม่บันทึกไว้ใน localStorage และกู้คืนเมื่อเปิดใหม่

### JSON Path
- **Tree แบบ lazy** ใช้คีย์บอร์ดได้ (ลูกศร, Enter, ←/→) แบ่งหน้าทีละ 200 รายการสำหรับ array ใหญ่
- **คัดลอก path 3 สไตล์**: JSONPath (`$.a[0].b`), JavaScript (`data.a[0].b`), Lodash (`a[0].b`) ดับเบิลคลิกที่ path เพื่อคัดลอกทันที
- **Copy value**: คัดลอกค่าที่เลือก (object / array จะเป็น JSON ที่จัดรูปแล้ว)
- **ค้นหา**: ตามคีย์ ค่า หรือทั้งคู่ รองรับ regex
- **JSONPath expression**: พิมพ์ในช่องค้นหาที่ขึ้นต้นด้วย `$` ได้เลย เช่น `$.users[*].name`
  - รองรับ `.key`, `['key']`, `[n]`, index ติดลบ, `[*]`, `..` (recursive), union `[0,2]`, slice `[1:3]`
  - ไม่รองรับ filter expression `?()`
- **เลือกความลึกของ tree**: Collapsed / 1 / 2 / 3 / Expand all (เอกสารที่เกิน 5,000 node จะลดเหลือความลึก 4 พร้อมแจ้งเตือน)
- **Format / Minify**
- **Error ที่หาตำแหน่งได้**: แสดงบรรทัดและคอลัมน์ พร้อมปุ่ม *Go to error*
- **แปลงเป็น JSON**: เปิดหรือวางข้อความแบบ JSON Lines, CSV (ตรวจ delimiter `,` `;` tab อัตโนมัติ) และ YAML
  - ไฟล์ที่แปลงจะกลายเป็นเอกสาร JSON ใหม่ (`ชื่อ.json`) และ **ไม่ผูกกับไฟล์ต้นฉบับ** ดังนั้น Save จะไม่ทับ CSV / YAML เดิม

### Locator
วาง HTML source ของหน้าเว็บ (หรือเปิดไฟล์ `.html` / `.htm`) แล้วคลิกองค์ประกอบใน preview เพื่อดู locator ที่ใช้เขียน test automation
- **Preview แบบ sandbox**: แสดงหน้าใน iframe ที่ไม่รัน script และบล็อกทุก request ภายนอก (CSP, ตัด `<base>`, `meta refresh`, resource hint) หน้าจึงแสดงด้วย inline style เท่านั้น
- **คลิกได้สองทาง**: คลิกองค์ประกอบใน preview แล้ว source จะเลือก start tag และเลื่อนไปให้ หรือคลิก / เลื่อนเคอร์เซอร์ใน source (ข้อความหรือแท็ก) แล้ว locator ขึ้นทันที
- **Select parent**: ขยับไปที่ element แม่เมื่อ locator ของตัวที่เลือกยังไม่เจาะจงพอ
- **เลือกไวยากรณ์ได้**: Playwright (`page.getByRole(...)`, `getByTestId`, `getByLabel` ฯลฯ) และ Robot Framework (SeleniumLibrary เช่น `id:`, `css:`, `xpath:`) จำค่าที่เลือกไว้ให้
- **ผู้สมัคร locator เรียงจากแนะนำที่สุด**: test id (`data-testid`, `data-test-id`, `data-test`, `data-qa`, `data-cy`), role + accessible name, label, placeholder, text, alt, title, id, name, link text, CSS (class), CSS path, XPath
  - Robot Framework ไม่มี role / label จึงข้ามสองแบบนี้
- **ป้ายจำนวนที่ตรง**: แต่ละ locator บอกว่าตรงกี่ element ในหน้า (`unique` = ใช้ได้เลย, `N matches` = ต้องจำกัดให้แคบลง)
- **Copy**: ปุ่ม Copy หรือดับเบิลคลิกที่โค้ด
- **เพิ่มเครื่องมือใหม่**: เพิ่ม `LocatorFramework` ใน `FRAMEWORKS` ที่ `src/lib/locatorFormats.ts`

### ทั่วไป
- **Command palette** (`Ctrl+K`): ค้นหาแบบ fuzzy รวมคำสั่งของไฟล์ มุมมอง และแต่ละแท็บ
- **เปิดไฟล์**: ปุ่ม Open, ลากไฟล์มาวางทั้งหน้า (สลับแท็บตามนามสกุล `.md` `.markdown` `.txt` `.json` `.jsonl` `.ndjson` `.csv` `.yaml` `.yml` `.html` `.htm`)
- **บันทึก**: `Ctrl+S` บันทึกทับไฟล์เดิม, `Ctrl+Shift+S` บันทึกเป็นไฟล์ใหม่
- **ไฟล์ล่าสุด** (Recent): จำได้ 10 ไฟล์ล่าสุด
- **Theme**: auto / light / dark
- **Focus mode**: ซ่อนแถบด้านบน ออกด้วย `Esc`
- **เตือนก่อนปิดหน้า** เมื่อมีงานที่ยังไม่บันทึก
- **PWA**: ติดตั้งเป็นแอปและใช้งานออฟไลน์ได้หลังเปิดครั้งแรก (ทำงานเฉพาะ build จริง ไม่ทำงานใน `npm run dev`)
- **รองรับจอแคบ**: layout สองคอลัมน์พับเป็นแนวตั้ง

## ตัวอย่างไฟล์

โฟลเดอร์ [examples/](examples/) มีไฟล์สำหรับลองฟีเจอร์ทั้งหมด เปิดด้วย `Ctrl+O` หรือลากมาวางที่หน้าต่าง

| ไฟล์ | เปิดในแท็บ | ใช้ลองอะไร |
| ---- | ---------- | ---------- |
| [showcase.md](examples/showcase.md) | Markdown | Outline, Read & edit, ค้นหา/แทนที่ (รวม regex `$3/$2/$1`), ตาราง, task list, code block ที่มี `#` (ต้องไม่นับเป็นหัวข้อ), นับคำไทย, Export, หลายเอกสาร |
| [showcase.json](examples/showcase.json) | JSON Path | tree หลายระดับ, `$.store.products[*].name`, `$..productId`, `$.matrix[1:3]`, คีย์พิเศษ (`e-mail`, `it's`, ชื่อไทย), ค่า `null`/`true`, ค้นหาแบบ regex, Copy value |
| [users.csv](examples/users.csv) | JSON Path | แปลง CSV (ค่าในเครื่องหมายคำพูด, `""`, ขึ้นบรรทัดใหม่ในเซลล์) |
| [config.yaml](examples/config.yaml) | JSON Path | แปลง YAML (object ซ้อน, array ผสม) |
| [events.jsonl](examples/events.jsonl) | JSON Path | แปลง JSON Lines (ข้ามบรรทัดว่าง) |
| [broken.json](examples/broken.json) | JSON Path | error ระบุบรรทัด/คอลัมน์ และปุ่ม *Go to error* |
| [login.html](examples/login.html) | Locator | หน้า login จำลอง: `data-testid`, label ↔ input, placeholder, link, ปุ่ม `.btn` ซ้ำหลายตัว (ดูป้าย matches), ตาราง |

แต่ละแท็บมีเอกสารตัวอย่าง (`showcase.md`, `showcase.json`, `login.html`) โหลดไว้ให้ตอนเปิดครั้งแรก

ไฟล์ที่แปลงมาจาก CSV / YAML / JSONL จะเป็นเอกสาร JSON ใหม่ ไม่ทับไฟล์ต้นฉบับ

## คีย์ลัด

| คีย์ | การทำงาน |
| ---- | -------- |
| `Ctrl+K` | เปิด command palette |
| `Ctrl+O` | เปิดไฟล์ |
| `Ctrl+S` | บันทึก |
| `Ctrl+Shift+S` | บันทึกเป็นไฟล์ใหม่ |
| `Ctrl+F` | ค้นหา (แท็บ Markdown) |
| `Ctrl+H` | ค้นหาและแทนที่ (แท็บ Markdown) |
| `Esc` | ปิด palette / แถบค้นหา / ออกจาก focus mode |
| `Enter` / `Shift+Enter` | ผลค้นหาถัดไป / ก่อนหน้า (ในช่อง Find) |

บน macOS ใช้ `Cmd` แทน `Ctrl`

## ข้อจำกัดและการรองรับเบราว์เซอร์

- **บันทึกทับไฟล์เดิมและ Recent** ใช้ [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API) ซึ่งมีใน Chrome / Edge
  เบราว์เซอร์อื่น (Firefox, Safari) จะเปิดไฟล์ผ่านช่องเลือกไฟล์ปกติ และ Save จะดาวน์โหลดไฟล์ใหม่แทน และไม่มีรายการ Recent
- ไฟล์ใหญ่เกิน **20 MB** จะไม่ถูกเปิด
- แท็บ Locator วิเคราะห์ DOM ที่ parse จาก HTML source เท่านั้น: **ไม่รัน JavaScript** และไม่โหลด CSS / รูป / font จากภายนอก ดังนั้นองค์ประกอบที่ถูกสร้างตอน runtime จะไม่ปรากฏ และจำนวน matches เป็นของหน้า static นี้ ควรตรวจซ้ำกับหน้าจริง
- เมื่อแก้ source ใน Locator preview จะโหลดใหม่ (หน่วงประมาณ 0.3 วินาที) และล้างองค์ประกอบที่เลือกไว้
- การแก้ไขใน WYSIWYG / Read & edit อาจจัดรูปแบบ Markdown ใหม่เล็กน้อยตอนบันทึก (เช่น สัญลักษณ์ bullet) เป็นพฤติกรรมของ editor
- Draft เก็บใน localStorage ถ้าเบราว์เซอร์บล็อกหรือเต็ม ระบบจะข้ามไปเงียบ ๆ และไม่กระทบการแก้ไข

## โครงสร้างโปรเจกต์

```
src/
├── main.ts            # ประกอบแอป: แท็บ, ปุ่ม, คีย์ลัด, theme, recent, drag-drop
├── lib/               # logic ล้วน (ไม่แตะ DOM) มีเทสต์คู่กันทุกไฟล์
│   ├── jsonPath.ts    # format path, parse, flatten
│   ├── jsonQuery.ts   # JSONPath evaluator
│   ├── jsonSearch.ts  # ค้นหา key / value / regex
│   ├── jsonError.ts   # หาตำแหน่ง error ของ JSON
│   ├── convert.ts     # JSONL / CSV / YAML → JSON
│   ├── locators.ts    # หา locator candidate ของ element (ไม่ผูกกับเครื่องมือ)
│   ├── locatorFormats.ts  # แปลง candidate เป็นโค้ด Playwright / Robot Framework + นับ matches
│   ├── accessibility.ts   # role และ accessible name
│   ├── domSelectors.ts, matchCount.ts   # CSS / XPath และการนับ element ที่ตรง
│   ├── previewDoc.ts  # เตรียม HTML สำหรับ iframe sandbox (CSP)
│   ├── sourceMap.ts   # จับคู่ element ใน preview กับตำแหน่งใน source
│   ├── findReplace.ts # ค้นหา / แทนที่
│   ├── outline.ts     # ดึงหัวข้อ Markdown
│   ├── docSet.ts      # สถานะหลายเอกสาร (immutable) และ draft
│   ├── textStats.ts   # นับคำ เวลาอ่าน
│   ├── commands.ts    # fuzzy filter ของ palette
│   ├── exportHtml.ts  # สร้างเอกสาร HTML
│   ├── recent.ts / recentStore.ts   # ไฟล์ล่าสุด (IndexedDB)
│   ├── theme.ts / readingPrefs.ts / safeStorage.ts
│   └── fileAccess.ts  # เปิด / บันทึกไฟล์
└── ui/                # ส่วนที่แตะ DOM
    ├── markdownTab.ts, findBar.ts
    ├── jsonTab.ts, jsonTree.ts
    ├── locatorTab.ts, locatorPreview.ts, textareaScroll.ts
    └── palette.ts, toast.ts, clipboard.ts, dom.ts, types.ts
public/                # manifest, service worker, icon (PWA)
```

เพิ่มแท็บใหม่ได้โดยทำ `TabController` (ดู `src/ui/types.ts`) แล้วเพิ่มเข้า `tabs` ใน `src/main.ts`
