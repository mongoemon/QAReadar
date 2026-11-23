#!/usr/bin/env node
/**
 * One-command release: bump version → changelog → test + build → commit → push → deploy
 * → desktop installers → GitHub Release.
 *
 *   npm run release -- <bump> "<commit message>" [options]
 *
 *   <bump>     patch | minor | major | 1.4.2 (exact) | none (keep the current version)
 *   options    --no-push     commit only, do not push (also skips the GitHub Release)
 *              --no-deploy   skip the Cloudflare Pages deploy
 *              --no-desktop  skip the desktop installers and the GitHub Release
 *              --dry-run     show what would happen, change nothing
 *
 * Desktop installers (Electron, into release/) and the GitHub Release v<version> are made
 * only when the version changes. macOS builds both .dmg (arm64 + x64) and Windows .exe;
 * Windows / Linux build the Windows .exe only. The GitHub Release needs the gh CLI logged in.
 *
 * Examples
 *   npm run release -- patch "fix: JSON search ignores case"
 *   npm run release -- minor "feat: export locators as CSV"
 *   npm run release -- none  "docs: update README"          (no version change)
 *   npm run deploy                                          (deploy only, no git)
 *
 * When the version changes and src/lib/changelog.ts has no entry for it yet, an entry is
 * added from the commit message (feat → added, fix → fixed, anything else → changed).
 * Edit the wording in changelog.ts before running if you want nicer release notes.
 * If tests or the build fail, the version and changelog changes are rolled back.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PAGES_PROJECT = 'qareadar'
const PAGES_BRANCH = 'main'
const SITE_URL = 'https://qareadar.pages.dev'
const DESKTOP_DIR = join(ROOT, 'release')
const FILES = {
  pkg: join(ROOT, 'package.json'),
  lock: join(ROOT, 'package-lock.json'),
  changelog: join(ROOT, 'src/lib/changelog.ts'),
}

// ── helpers ─────────────────────────────────────────────────────────────────
const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text)
const bold = color('1')
const green = color('32')
const red = color('31')
const dim = color('2')

const step = (text) => console.log(`\n${bold('▸')} ${bold(text)}`)
const fail = (text) => {
  console.error(`\n${red('✖')} ${text}`)
  process.exit(1)
}

// On Windows npm / npx are .cmd shims, which Node can only start through a shell. Their
// arguments here never contain spaces, so that is safe; git (with the commit message) runs
// without a shell so the message is passed through untouched.
const needsShell = (cmd) => process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx')

/** Run a command with live output; throws on a non-zero exit. */
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: needsShell(cmd) })
/** Run a command and return its trimmed stdout. */
const read = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: needsShell(cmd) }).trim()

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump
  const [major, minor, patch] = current.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  if (bump === 'none') return current
  return null
}

const today = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** feat: → added, fix: → fixed, everything else → changed. The type prefix is dropped. */
function changelogEntry(version, message) {
  const firstLine = message.split('\n')[0].trim()
  const match = /^(\w+)(\([^)]*\))?!?:\s*(.+)$/.exec(firstLine)
  const type = match?.[1] ?? ''
  const text = match?.[3] ?? firstLine
  const section = type === 'feat' ? 'added' : type === 'fix' ? 'fixed' : 'changed'
  return `  {\n    version: '${version}',\n    date: '${today()}',\n    ${section}: [${JSON.stringify(text)}],\n  },\n`
}

/** String literals inside `section: [ … ]` of one changelog entry's source text. */
function changelogItems(entrySource, section) {
  const list = new RegExp(`\\b${section}:\\s*\\[([\\s\\S]*?)\\]\\s*,?\\s*(?:\\n\\s*\\w+:|\\n\\s*\\})`).exec(entrySource)
  if (!list) return []
  const strings = list[1].match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) ?? []
  return strings.map((s) => s.slice(1, -1).replace(/\\(.)/g, '$1'))
}

/** GitHub Release notes: downloads, first-open help, then the changelog entry for `version`. */
function releaseNotes(version, changelogSource, assets) {
  const start = changelogSource.indexOf(`version: '${version}'`)
  const end = changelogSource.indexOf('\n  {', start)
  const entry = start === -1 ? '' : changelogSource.slice(start, end === -1 ? undefined : end)
  const label = (name) =>
    name.includes('mac-arm64') ? 'macOS — Apple Silicon (M1/M2/M3/M4)'
    : name.includes('mac-x64') ? 'macOS — Intel'
    : name.includes('Setup') ? 'Windows — ตัวติดตั้ง'
    : name.includes('portable') ? 'Windows — portable (ไม่ต้องติดตั้ง)'
    : name
  const lines = [
    '## ดาวน์โหลด', '', '| ระบบ | ไฟล์ |', '| --- | --- |',
    ...assets.map((a) => `| ${label(a)} | \`${a}\` |`),
    '', `ใช้บนเว็บได้เหมือนเดิมที่ ${SITE_URL}`, '',
    '### เปิดครั้งแรก (ไฟล์ยังไม่ได้ sign)', '',
    '- **macOS**: ลากแอปไปไว้ใน Applications แล้วคลิกขวาที่แอป → Open → Open',
    '  (หรือรัน `xattr -cr /Applications/QAReadar.app` ใน Terminal)',
    '- **Windows**: ถ้า SmartScreen ขึ้นเตือน ให้กด More info → Run anyway',
  ]
  const sections = [['added', 'เพิ่ม'], ['changed', 'เปลี่ยน'], ['fixed', 'แก้ไข']]
  const body = sections
    .map(([key, title]) => [title, changelogItems(entry, key)])
    .filter(([, items]) => items.length > 0)
  if (body.length > 0) {
    lines.push('', '## มีอะไรใหม่')
    for (const [title, items] of body) lines.push('', `### ${title}`, ...items.map((i) => `- ${i}`))
  }
  return lines.join('\n') + '\n'
}

// ── arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [bump, message] = args.filter((a) => !a.startsWith('--'))
const dryRun = flags.has('--dry-run')
const push = !flags.has('--no-push')
const deploy = !flags.has('--no-deploy')
const noDesktop = flags.has('--no-desktop')

for (const flag of flags) {
  if (!['--dry-run', '--no-push', '--no-deploy', '--no-desktop'].includes(flag)) fail(`Unknown option ${flag}`)
}
if (!bump) {
  fail('Usage: npm run release -- <patch|minor|major|x.y.z|none> "<commit message>" [--no-push] [--no-deploy] [--no-desktop] [--dry-run]')
}

// ── preflight ───────────────────────────────────────────────────────────────
const originals = Object.fromEntries(Object.entries(FILES).map(([k, path]) => [k, readFileSync(path, 'utf8')]))
const current = JSON.parse(originals.pkg).version
const target = nextVersion(current, bump)
if (target === null) fail(`"${bump}" is not patch, minor, major, none or a version like 1.2.3`)

const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
const dirty = read('git', ['status', '--porcelain']) !== ''
const versionChanges = target !== current
if ((dirty || versionChanges) && !message) fail('A commit message is required: npm run release -- patch "fix: …"')

console.log(bold('QAReadar release'))
console.log(`  version  ${current}${versionChanges ? ` → ${green(target)}` : dim(' (unchanged)')}`)
console.log(`  branch   ${branch}${branch === 'main' ? '' : red('  (not main!)')}`)
console.log(`  commit   ${dirty || versionChanges ? message.split('\n')[0] : dim('nothing to commit')}`)
console.log(`  push     ${push ? 'yes' : dim('no')}`)
const desktop = versionChanges && !noDesktop
const desktopTargets = process.platform === 'darwin' ? ['--mac', '--win'] : ['--win']
const githubRelease = desktop && push
console.log(`  deploy   ${deploy ? `yes → ${SITE_URL}` : dim('no')}`)
console.log(`  desktop  ${desktop ? `yes (${desktopTargets.map((t) => t.slice(2)).join(' + ')})` : dim(versionChanges ? 'no' : 'no (version unchanged)')}`)
console.log(`  github   ${githubRelease ? `yes → release v${target}` : dim('no')}`)
if (dryRun) {
  console.log(dim('\n(dry run — nothing changed)'))
  process.exit(0)
}

const restore = () => {
  for (const [k, path] of Object.entries(FILES)) writeFileSync(path, originals[k])
}

// ── 1. version + changelog ──────────────────────────────────────────────────
if (versionChanges) {
  step(`Bump version to ${target}`)
  run('npm', ['version', target, '--no-git-tag-version', '--allow-same-version'])
  if (!originals.changelog.includes(`version: '${target}'`)) {
    const anchor = 'export const CHANGELOG: readonly Release[] = [\n'
    if (!originals.changelog.includes(anchor)) {
      restore()
      fail('Could not find the CHANGELOG array in src/lib/changelog.ts')
    }
    writeFileSync(FILES.changelog, originals.changelog.replace(anchor, anchor + changelogEntry(target, message)))
    console.log(`  added a changelog entry for v${target} ${dim('(src/lib/changelog.ts)')}`)
  }
}

// ── 2. test + build ─────────────────────────────────────────────────────────
try {
  step('Test')
  run('npm', ['test'])
  step('Build')
  run('npm', ['run', 'build'])
} catch {
  if (versionChanges) {
    restore()
    console.error(dim('  version and changelog changes rolled back'))
  }
  fail('Tests or build failed — nothing was committed, pushed or deployed.')
}

// ── 3. commit ───────────────────────────────────────────────────────────────
step('Commit')
if (read('git', ['status', '--porcelain']) !== '') {
  run('git', ['add', '-A'])
  run('git', ['commit', '-m', message])
} else {
  console.log(dim('  working tree clean — nothing to commit'))
}

// ── 4. push ─────────────────────────────────────────────────────────────────
if (push) {
  step(`Push ${branch}`)
  try {
    run('git', ['push', 'origin', branch])
  } catch {
    fail('git push failed (the commit is kept locally). Pull/rebase, then run: git push && npm run deploy')
  }
}

// ── 5. deploy ───────────────────────────────────────────────────────────────
if (deploy) {
  step('Deploy to Cloudflare Pages')
  try {
    run('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', PAGES_PROJECT, '--branch', PAGES_BRANCH])
  } catch {
    fail('Deploy failed. If you are logged out, run: npx wrangler login — then: npm run deploy')
  }
}

// ── 6. desktop installers ───────────────────────────────────────────────────
let assets = []
if (desktop) {
  step(`Desktop installers (${desktopTargets.map((t) => t.slice(2)).join(' + ')})`)
  // dist/ is already built by step 2. No signing certificate: skip the keychain lookup.
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    execFileSync('npx', ['electron-builder', ...desktopTargets, '--publish', 'never'], {
      cwd: ROOT, stdio: 'inherit', shell: needsShell('npx'), env,
    })
  } catch {
    fail(`Desktop build failed (web release is done). Retry with: npx electron-builder ${desktopTargets.join(' ')}`)
  }
  assets = readdirSync(DESKTOP_DIR)
    .filter((name) => name.includes(`-${target}`) && /\.(dmg|exe)$/.test(name) && !name.includes('__uninstaller'))
    .sort()
  for (const name of assets) console.log(`  ${name}`)
}

// ── 7. GitHub Release ───────────────────────────────────────────────────────
if (githubRelease) {
  step(`GitHub Release v${target}`)
  const tag = `v${target}`
  const files = assets.map((name) => join(DESKTOP_DIR, name))
  const notesFile = join(DESKTOP_DIR, `notes-${target}.md`)
  writeFileSync(notesFile, releaseNotes(target, readFileSync(FILES.changelog, 'utf8'), assets))
  let exists = false
  try {
    read('gh', ['release', 'view', tag, '--json', 'tagName'])
    exists = true
  } catch {
    // no release with this tag yet
  }
  try {
    if (exists) {
      run('gh', ['release', 'upload', tag, ...files, '--clobber'])
    } else {
      const sha = read('git', ['rev-parse', 'HEAD'])
      run('gh', ['release', 'create', tag, '--target', sha, '--title', `QAReadar ${tag}`, '--notes-file', notesFile, ...files])
    }
    console.log(`  ${read('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url'])}`)
  } catch {
    fail(`GitHub Release failed (gh installed and logged in? gh auth login). Retry: gh release create ${tag} release/*${target}*.dmg release/*${target}*.exe --notes-file ${notesFile}`)
  }
}

console.log(`\n${green('✔')} ${bold(`Released v${target}`)}${deploy ? ` → ${SITE_URL}` : ''}`)
