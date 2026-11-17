import { cssEscape, cssString, xpathName, xpathString } from './domSelectors'
import { findCandidates, type Candidate, type CandidateKind } from './locators'
import {
  countAttrContains,
  countAttrEquals,
  countCss,
  countLabel,
  countLinkText,
  countRole,
  countText,
  countXpath,
} from './matchCount'

export interface FormattedLocator {
  readonly label: string
  readonly code: string
  /** Elements the locator hits in the page; null when it cannot be measured. */
  readonly matches: number | null
}

/**
 * To support another tool, add a LocatorFramework and list it in FRAMEWORKS.
 * `format` returns null for candidates the tool cannot express.
 */
export interface LocatorFramework {
  readonly id: string
  readonly label: string
  format(candidate: Candidate, doc: Document): FormattedLocator | null
}

const LABELS: Readonly<Record<CandidateKind, string>> = {
  testid: 'Test ID',
  role: 'Role',
  label: 'Label',
  placeholder: 'Placeholder',
  text: 'Text',
  alt: 'Alt text',
  title: 'Title',
  id: 'ID',
  name: 'Name',
  link: 'Link text',
  'css-class': 'CSS (class)',
  css: 'CSS',
  xpath: 'XPath',
}

const made = (kind: CandidateKind, code: string, matches: number | null): FormattedLocator => ({
  label: LABELS[kind],
  code,
  matches,
})

// ── Playwright (JavaScript / TypeScript) ──────────────────────────────────

const DEFAULT_TEST_ID_ATTRIBUTE = 'data-testid'
const NBSP = ' '

const jsString = (value: string): string =>
  `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\f/g, '\\f')}'`

const pwLocator = (kind: CandidateKind, selector: string, matches: number | null): FormattedLocator =>
  made(kind, `page.locator(${jsString(selector)})`, matches)

function formatPlaywright(c: Candidate, doc: Document): FormattedLocator | null {
  const v = jsString(c.value)
  switch (c.kind) {
    case 'testid':
      return c.extra === DEFAULT_TEST_ID_ATTRIBUTE
        ? made('testid', `page.getByTestId(${v})`, countAttrEquals(doc, DEFAULT_TEST_ID_ATTRIBUTE, c.value))
        : pwLocator('testid', `[${c.extra}=${cssString(c.value)}]`, countAttrEquals(doc, c.extra ?? '', c.value))
    case 'role':
      return made('role', `page.getByRole(${jsString(c.extra ?? '')}, { name: ${v} })`, countRole(doc, c.extra ?? '', c.value))
    case 'label':
      return made('label', `page.getByLabel(${v})`, countLabel(doc, c.value))
    case 'placeholder':
      return made('placeholder', `page.getByPlaceholder(${v})`, countAttrContains(doc, 'placeholder', c.value))
    case 'text':
      return made('text', `page.getByText(${v})`, countText(doc, c.value))
    case 'alt':
      return made('alt', `page.getByAltText(${v})`, countAttrContains(doc, 'alt', c.value))
    case 'title':
      return made('title', `page.getByTitle(${v})`, countAttrContains(doc, 'title', c.value))
    case 'id':
      return pwLocator('id', `#${cssEscape(c.value)}`, countAttrEquals(doc, 'id', c.value))
    case 'name':
      return pwLocator('name', `[name=${cssString(c.value)}]`, countAttrEquals(doc, 'name', c.value))
    case 'css-class':
    case 'css':
      return pwLocator(c.kind, c.value, countCss(doc, c.value))
    case 'xpath':
      return pwLocator('xpath', `xpath=${c.value}`, countXpath(doc, c.value))
    default:
      return null
  }
}

// ── Robot Framework (SeleniumLibrary locator strategies) ──────────────────

/** Protect a value from Robot syntax: backslashes, ${var}/@{list}/&{dict}/%{env}, and 2+ spaces. */
const robotEscape = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/([$@&%])\{/g, '\\$1{')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/ {2,}/g, (run) => ` ${'\\ '.repeat(run.length - 1)}`)

const robot = (kind: CandidateKind, strategy: string, value: string, matches: number | null): FormattedLocator =>
  made(kind, `${strategy}:${robotEscape(value)}`, matches)

function formatRobot(c: Candidate, doc: Document): FormattedLocator | null {
  const attrCss = (name: string): FormattedLocator =>
    robot(c.kind, 'css', `[${name}=${cssString(c.value)}]`, countAttrEquals(doc, name, c.value))
  switch (c.kind) {
    case 'testid':
      return c.extra === undefined ? null : attrCss(c.extra)
    case 'placeholder':
    case 'alt':
    case 'title':
      return attrCss(c.kind)
    case 'id':
      return robot('id', 'id', c.value, countAttrEquals(doc, 'id', c.value))
    case 'name':
      return robot('name', 'name', c.value, countAttrEquals(doc, 'name', c.value))
    case 'link':
      return robot('link', 'link', c.value, countLinkText(doc, c.value))
    case 'text': {
      const subject = c.extra === 'nbsp' ? `translate(., "${NBSP}", " ")` : '.'
      const xpath = `//${xpathName(c.tag)}[normalize-space(${subject})=${xpathString(c.value)}]`
      return robot('text', 'xpath', xpath, countXpath(doc, xpath))
    }
    case 'css-class':
    case 'css':
      return robot(c.kind, 'css', c.value, countCss(doc, c.value))
    case 'xpath':
      return robot('xpath', 'xpath', c.value, countXpath(doc, c.value))
    default:
      // Role and label locators have no SeleniumLibrary equivalent.
      return null
  }
}

// ── Cucumber Java (Selenium WebDriver `By` locators) ──────────────────────

const javaString = (value: string): string =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\f/g, '\\f')}"`

const javaBy = (kind: CandidateKind, method: string, value: string, matches: number | null): FormattedLocator =>
  made(kind, `driver.findElement(By.${method}(${javaString(value)}))`, matches)

function formatCucumberJava(c: Candidate, doc: Document): FormattedLocator | null {
  const attrCss = (name: string): FormattedLocator =>
    javaBy(c.kind, 'cssSelector', `[${name}=${cssString(c.value)}]`, countAttrEquals(doc, name, c.value))
  switch (c.kind) {
    case 'testid':
      return c.extra === undefined ? null : attrCss(c.extra)
    case 'placeholder':
    case 'alt':
    case 'title':
      return attrCss(c.kind)
    case 'id':
      return javaBy('id', 'id', c.value, countAttrEquals(doc, 'id', c.value))
    case 'name':
      return javaBy('name', 'name', c.value, countAttrEquals(doc, 'name', c.value))
    case 'link':
      return javaBy('link', 'linkText', c.value, countLinkText(doc, c.value))
    case 'text': {
      const subject = c.extra === 'nbsp' ? `translate(., "${NBSP}", " ")` : '.'
      const xpath = `//${xpathName(c.tag)}[normalize-space(${subject})=${xpathString(c.value)}]`
      return javaBy('text', 'xpath', xpath, countXpath(doc, xpath))
    }
    case 'css-class':
    case 'css':
      return javaBy(c.kind, 'cssSelector', c.value, countCss(doc, c.value))
    case 'xpath':
      return javaBy('xpath', 'xpath', c.value, countXpath(doc, c.value))
    default:
      // Selenium's By has no role or label strategy.
      return null
  }
}

// ── Playwright Java ───────────────────────────────────────────────────────

const pwJavaLocator = (kind: CandidateKind, selector: string, matches: number | null): FormattedLocator =>
  made(kind, `page.locator(${javaString(selector)})`, matches)

function formatPlaywrightJava(c: Candidate, doc: Document): FormattedLocator | null {
  const v = javaString(c.value)
  switch (c.kind) {
    case 'testid':
      return c.extra === DEFAULT_TEST_ID_ATTRIBUTE
        ? made('testid', `page.getByTestId(${v})`, countAttrEquals(doc, DEFAULT_TEST_ID_ATTRIBUTE, c.value))
        : pwJavaLocator('testid', `[${c.extra}=${cssString(c.value)}]`, countAttrEquals(doc, c.extra ?? '', c.value))
    case 'role': {
      const role = c.extra ?? ''
      // AriaRole constants are the ARIA role names upper-cased (e.g. AriaRole.SPINBUTTON).
      if (!/^[a-z]+$/.test(role)) return null
      return made(
        'role',
        `page.getByRole(AriaRole.${role.toUpperCase()}, new Page.GetByRoleOptions().setName(${v}))`,
        countRole(doc, role, c.value),
      )
    }
    case 'label':
      return made('label', `page.getByLabel(${v})`, countLabel(doc, c.value))
    case 'placeholder':
      return made('placeholder', `page.getByPlaceholder(${v})`, countAttrContains(doc, 'placeholder', c.value))
    case 'text':
      return made('text', `page.getByText(${v})`, countText(doc, c.value))
    case 'alt':
      return made('alt', `page.getByAltText(${v})`, countAttrContains(doc, 'alt', c.value))
    case 'title':
      return made('title', `page.getByTitle(${v})`, countAttrContains(doc, 'title', c.value))
    case 'id':
      return pwJavaLocator('id', `#${cssEscape(c.value)}`, countAttrEquals(doc, 'id', c.value))
    case 'name':
      return pwJavaLocator('name', `[name=${cssString(c.value)}]`, countAttrEquals(doc, 'name', c.value))
    case 'css-class':
    case 'css':
      return pwJavaLocator(c.kind, c.value, countCss(doc, c.value))
    case 'xpath':
      return pwJavaLocator('xpath', `xpath=${c.value}`, countXpath(doc, c.value))
    default:
      return null
  }
}

export const FRAMEWORKS: readonly LocatorFramework[] = [
  { id: 'playwright', label: 'Playwright', format: formatPlaywright },
  { id: 'robot', label: 'Robot Framework', format: formatRobot },
  { id: 'cucumber-java', label: 'Cucumber Java (Selenium)', format: formatCucumberJava },
  { id: 'playwright-java', label: 'Playwright Java', format: formatPlaywrightJava },
]

export const frameworkById = (id: string): LocatorFramework | undefined =>
  FRAMEWORKS.find((framework) => framework.id === id)

/** All locators for `el` in the chosen framework's syntax, best first. */
export function locatorsFor(frameworkId: string, el: Element): FormattedLocator[] {
  const framework = frameworkById(frameworkId)
  if (!framework) return []
  return findCandidates(el).flatMap((candidate) => {
    const formatted = framework.format(candidate, el.ownerDocument)
    return formatted ? [formatted] : []
  })
}
