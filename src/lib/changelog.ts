/**
 * Release notes shown when the header version badge is held for 3 seconds.
 * Newest first. When bumping `version` in package.json, add an entry here too —
 * changelog.test.ts fails if the top entry does not match package.json.
 */
export interface Release {
  readonly version: string
  /** ISO date, YYYY-MM-DD. */
  readonly date: string
  readonly added?: readonly string[]
  readonly changed?: readonly string[]
  readonly fixed?: readonly string[]
}

export const CHANGELOG: readonly Release[] = [
  {
    version: '1.1.0',
    date: '2026-11-17',
    added: [
      'Source view: ลากเส้นแบ่งเพื่อขยาย/หดฝั่ง Markdown กับ Preview ได้ (20–80%) พร้อมปุ่ม ⇔ รีเซ็ตกลับเป็น 50/50 และจำขนาดไว้',
      'Locator: รองรับ Cucumber Java (Selenium WebDriver) และ Playwright Java',
      'Markdown: จำเอกสารที่เปิดค้างไว้และเปิดกลับมาเหมือนเดิมหลังโหลดหน้าใหม่',
      'Markdown: ปุ่ม Refresh โหลดไฟล์จากดิสก์ใหม่เมื่อถูกแก้จากโปรแกรมอื่น',
      'แจ้งเตือนเมื่อไฟล์บนดิสก์ถูกย้ายหรือลบ (ข้อความในแอปไม่หาย)',
      'Changelog: กดค้างที่เลขเวอร์ชันมุมซ้ายบน 3 วินาที',
    ],
    fixed: [
      'ลากไฟล์ลงช่อง WYSIWYG แล้วหน้าค้าง/จอขาว — ไฟล์ที่ลากมาจะเปิดเป็นเอกสารเสมอ ไม่ถูกฝังเป็นรูป base64',
      'ไฟล์ binary (รูป, PDF, zip) แสดง "Unsupported file type" แทนการพยายามเปิด',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-12',
    added: [
      'เปลี่ยนชื่อแอปเป็น QAReadar และแสดงเลขเวอร์ชันที่ header',
      'ลิงก์ไปยัง GitHub repo ที่ header',
    ],
    fixed: ['Locator preview: จับคู่ตำแหน่งใน source และ scroll sync แม่นขึ้น'],
  },
]
