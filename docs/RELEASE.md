# คู่มือออก release QAReadar

สคริปต์ release ทำทุกขั้นตอนในคำสั่งเดียว ไม่ต้องทำมือทีละขั้น:

```
เพิ่มเลขเวอร์ชัน → เพิ่ม changelog → รันเทสต์ + build → commit → push → deploy
```

เว็บที่ deploy แล้วอยู่ที่ **https://qareadar.pages.dev** (Cloudflare Pages, project `qareadar`)

---

## 1. เตรียมเครื่องครั้งแรก (ทำครั้งเดียว)

| ต้องมี | วิธีเช็ก | ถ้ายังไม่มี |
| ------ | -------- | ----------- |
| Node.js 20 ขึ้นไป | `node -v` | ติดตั้งจาก https://nodejs.org |
| Git ที่ push ขึ้น GitHub ได้ | `git push` ใช้ได้ปกติ | ตั้งค่า SSH key หรือ GitHub CLI (`gh auth login`) |
| แพ็กเกจของโปรเจกต์ | มีโฟลเดอร์ `node_modules` | `npm install` |
| login Cloudflare | `npx wrangler whoami` แสดงอีเมล | `npx wrangler login` (เปิดเบราว์เซอร์ให้กดอนุญาต) |

**Windows / PowerShell**: ถ้ารัน `.ps1` แล้วขึ้นว่า *running scripts is disabled* ให้รันครั้งเดียว:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 2. วิธีใช้

รันที่โฟลเดอร์โปรเจกต์ (`QAReadar/`)

**macOS / Linux / Windows (ผ่าน npm)**

```bash
npm run release -- <ประเภท> "<ข้อความ commit>" [ตัวเลือก]
```

> ต้องมี `--` หลัง `npm run release` เสมอ ไม่งั้น npm จะกินตัวเลือกไปเอง

**Windows PowerShell**

```powershell
.\scripts\release.ps1 <ประเภท> "<ข้อความ commit>" [-NoPush] [-NoDeploy] [-DryRun]
```

### ประเภท (เลขเวอร์ชัน)

เวอร์ชันมีรูปแบบ `MAJOR.MINOR.PATCH` เช่น `1.2.0`

| ประเภท | ใช้เมื่อ | ตัวอย่าง |
| ------ | -------- | -------- |
| `patch` | แก้บั๊ก ปรับเล็กน้อย | 1.2.0 → **1.2.1** |
| `minor` | เพิ่มฟีเจอร์ใหม่ | 1.2.0 → **1.3.0** |
| `major` | เปลี่ยนใหญ่ที่ผู้ใช้ต้องปรับตัว | 1.2.0 → **2.0.0** |
| `1.5.0` | กำหนดเลขเองตรง ๆ | → **1.5.0** |
| `none` | ไม่เปลี่ยนเวอร์ชัน (เช่น แก้เอกสาร) | 1.2.0 → 1.2.0 |

### ตัวเลือก

| npm | PowerShell | ผล |
| --- | ---------- | -- |
| `--dry-run` | `-DryRun` | แสดงว่าจะทำอะไร **โดยไม่แก้อะไรจริง** ใช้เช็กก่อนรันจริง |
| `--no-push` | `-NoPush` | commit ในเครื่องอย่างเดียว ไม่ push |
| `--no-deploy` | `-NoDeploy` | ไม่ deploy ขึ้นเว็บ |

### ตัวอย่าง

```bash
# แก้บั๊ก → 1.2.1 แล้ว deploy
npm run release -- patch "fix: ค้นหา JSON ไม่สนตัวพิมพ์เล็ก-ใหญ่"

# เพิ่มฟีเจอร์ → 1.3.0
npm run release -- minor "feat: export locator เป็น CSV"

# แก้ README อย่างเดียว ไม่ต้องขึ้นเวอร์ชันและไม่ต้อง deploy
npm run release -- none "docs: แก้ README" --no-deploy

# ดูก่อนว่าจะเกิดอะไรขึ้น
npm run release -- patch "fix: ..." --dry-run

# deploy อย่างเดียว (ไม่แตะ git ไม่เปลี่ยนเวอร์ชัน)
npm run deploy
```

---

## 3. สคริปต์ทำอะไรบ้าง ทีละขั้น

1. **สรุปก่อนเริ่ม** แสดงเวอร์ชันเดิม → ใหม่, branch, ข้อความ commit, จะ push / deploy หรือไม่
   - ถ้าไม่ได้อยู่ branch `main` จะขึ้นเตือนสีแดง `(not main!)` แต่ยังทำต่อ
2. **เพิ่มเลขเวอร์ชัน** ใน `package.json` และ `package-lock.json`
3. **เพิ่ม changelog** ใน `src/lib/changelog.ts` ถ้ายังไม่มีรายการของเวอร์ชันนี้ (ดูหัวข้อ 4)
4. **รันเทสต์** (`npm test`) และ **build** (`npm run build` ซึ่งเช็ก type ด้วย)
   - ถ้าไม่ผ่าน: **คืนเลขเวอร์ชันและ changelog เป็นค่าเดิม** แล้วหยุด ไม่ commit / push / deploy
5. **Commit** ทุกไฟล์ที่เปลี่ยนในโปรเจกต์ (`git add -A`) ด้วยข้อความที่ให้มา
   - ถ้าไม่มีอะไรเปลี่ยน จะข้ามขั้นนี้
6. **Push** ขึ้น GitHub (branch ปัจจุบัน)
7. **Deploy** โฟลเดอร์ `dist/` ขึ้น Cloudflare Pages
8. ขึ้น `✔ Released vX.Y.Z → https://qareadar.pages.dev` เมื่อเสร็จ

> ⚠️ ขั้น commit ใช้ `git add -A` คือ **ทุกไฟล์ที่เปลี่ยน** จะเข้า commit ด้วย
> ควรดู `git status` ก่อนรัน ถ้ามีไฟล์ที่ยังไม่อยากส่ง ให้ย้ายออกหรือ `git stash` ไว้ก่อน

---

## 4. Changelog (บันทึกการเปลี่ยนแปลง)

ผู้ใช้ดู changelog ได้โดย **กดค้างที่เลขเวอร์ชันมุมซ้ายบน 3 วินาที**
ข้อมูลอยู่ที่ `src/lib/changelog.ts` เรียงจากใหม่ไปเก่า

### แบบอัตโนมัติ

ถ้ายังไม่มีรายการของเวอร์ชันใหม่ สคริปต์จะสร้างจาก **บรรทัดแรก** ของข้อความ commit:

| ข้อความขึ้นต้นด้วย | ลงหมวด |
| ------------------ | ------ |
| `feat:` | เพิ่ม (added) |
| `fix:` | แก้ไข (fixed) |
| อื่น ๆ (`chore:`, `docs:`, `refactor:` …) | เปลี่ยน (changed) |

เช่น `fix: ค้นหา JSON ไม่สนตัวพิมพ์` จะได้

```ts
{
  version: '1.2.1',
  date: '2026-11-18',
  fixed: ["ค้นหา JSON ไม่สนตัวพิมพ์"],
},
```

### แบบเขียนเอง (แนะนำเมื่อมีหลายเรื่องในรอบเดียว)

เพิ่มรายการไว้บนสุดของ `CHANGELOG` **ก่อนรันสคริปต์** โดยใส่เลขเวอร์ชันที่กำลังจะออก
สคริปต์จะเห็นว่ามีอยู่แล้วและไม่เพิ่มซ้ำ

```ts
export const CHANGELOG: readonly Release[] = [
  {
    version: '1.3.0',
    date: '2026-11-20',
    added: ['Locator: export เป็น CSV', 'JSON: ค้นหาด้วย regex แบบ multiline'],
    fixed: ['ปุ่ม Refresh ไม่ทำงานบน Firefox'],
  },
  // ...รายการเก่า
]
```

> มีเทสต์บังคับว่ารายการบนสุดต้องตรงกับเวอร์ชันใน `package.json`
> ถ้าเปลี่ยนเลขเวอร์ชันเองด้วยมือแต่ลืมเพิ่ม changelog เทสต์จะไม่ผ่าน

---

## 5. ปัญหาที่พบบ่อย

| อาการ | สาเหตุ | วิธีแก้ |
| ----- | ------ | ------- |
| `A commit message is required` | มีไฟล์ที่เปลี่ยนหรือมีการขึ้นเวอร์ชัน แต่ไม่ได้ใส่ข้อความ | ใส่ข้อความ commit ในเครื่องหมาย `"..."` |
| `"xxx" is not patch, minor, major, none…` | พิมพ์ประเภทผิด | ใช้ `patch` / `minor` / `major` / `none` หรือเลขแบบ `1.2.3` |
| `Tests or build failed` | เทสต์หรือ type ไม่ผ่าน | ดู error ด้านบน แก้แล้วรันใหม่ (เลขเวอร์ชันถูกคืนค่าให้แล้ว) |
| `git push failed` | มี commit ใหม่บน GitHub ที่เครื่องยังไม่มี หรือ login GitHub หมดอายุ | `git pull --rebase` แล้ว `git push` และ `npm run deploy` (commit ยังอยู่ ไม่ต้อง release ใหม่) |
| `Deploy failed` | login Cloudflare หมดอายุ | `npx wrangler login` แล้ว `npm run deploy` |
| PowerShell: *running scripts is disabled* | Windows บล็อกสคริปต์ | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `npm run release patch ...` ไม่ทำงานตามที่คิด | ลืม `--` | ใช้ `npm run release -- patch "..."` |
| เว็บยังเป็นเวอร์ชันเก่า | cache ของเบราว์เซอร์ / service worker (PWA) | รีโหลดแบบ hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) หรือปิดแท็บแล้วเปิดใหม่ |

### ถ้า release ไปแล้วอยากย้อนกลับ

- **ย้อนเว็บ**: เข้า Cloudflare Dashboard → Workers & Pages → `qareadar` → Deployments → เลือกอันก่อนหน้า → *Rollback to this deployment*
- **ย้อนโค้ด**: `git revert HEAD` แล้วรัน `npm run release -- patch "revert: ..."`

---

## 6. ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
| ---- | ------- |
| `scripts/release.mjs` | สคริปต์หลัก (Node.js) |
| `scripts/release.ps1` | ตัวเรียกจาก PowerShell ส่งต่อไปที่ `release.mjs` |
| `package.json` → `scripts.release` / `scripts.deploy` | คำสั่ง `npm run release` / `npm run deploy` |
| `src/lib/changelog.ts` | รายการ changelog |
| `src/lib/changelog.test.ts` | เทสต์ที่บังคับให้ changelog ตรงกับเวอร์ชัน |

ถ้าเปลี่ยนชื่อ Cloudflare Pages project หรือ URL ให้แก้ค่า `PAGES_PROJECT` / `SITE_URL` ด้านบนของ `scripts/release.mjs` และคำสั่ง `deploy` ใน `package.json`

---

## 7. แอป Desktop (macOS / Windows)

ห่อเว็บแอปด้วย Electron (`electron/main.cjs`) ตั้งค่า build อยู่ใน `package.json` → `build` ไฟล์ผลลัพธ์อยู่ในโฟลเดอร์ `release/`

| คำสั่ง | ได้ไฟล์ |
| ------ | ------- |
| `npm run desktop` | เปิดแอปแบบ desktop เพื่อทดสอบ (ยังไม่ทำไฟล์ติดตั้ง) |
| `npm run dist:mac` | `QAReadar-<ver>-mac-arm64.dmg` (Apple Silicon), `QAReadar-<ver>-mac-x64.dmg` (Intel) และ `.zip` |
| `npm run dist:win` | `QAReadar-Setup-<ver>.exe` (ตัวติดตั้ง), `QAReadar-<ver>-portable.exe` (ดับเบิลคลิกใช้ได้เลย) |
| `npm run dist:all` | ทั้งสองแบบ (build Windows จาก Mac ได้ ไม่ต้องลง Wine) |

ไฟล์ยังไม่ได้ sign ดังนั้นตอนเปิดครั้งแรก:

- **macOS**: คลิกขวาที่แอป → Open → Open หรือรัน `xattr -cr /Applications/QAReadar.app`
- **Windows**: SmartScreen ขึ้นเตือน → More info → Run anyway

ไอคอนแอปคือ `build/icon.png` (1024×1024 render จาก `public/icon.svg`)

> ถ้ารัน `npm run desktop` จาก terminal ใน VS Code แล้วแอปปิดทันที ให้รัน `unset ELECTRON_RUN_AS_NODE` ก่อน (VS Code ตั้งตัวแปรนี้ไว้ ทำให้ Electron ทำงานเป็น Node ธรรมดา)
