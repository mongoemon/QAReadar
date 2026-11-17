import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { FRAMEWORKS, frameworkById, locatorsFor, type FormattedLocator } from './locatorFormats'

const dom = (html: string): Document => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document
const pick = (doc: Document, selector: string): Element => {
  const found = doc.querySelector(selector)
  if (!found) throw new Error(`fixture is missing ${selector}`)
  return found
}

const FORM = `
  <form>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" placeholder="you@example.com" data-testid="email-input" class="field wide">
    <input name="pw" type="password" placeholder="Password" class="field">
    <button type="submit" class="btn primary">Sign in</button>
    <button type="button" class="btn">Cancel</button>
    <a href="/forgot" title="Reset it">Forgot password?</a>
    <img src="x.png" alt="Company logo">
  </form>`

const codeOf = (list: readonly FormattedLocator[], label: string): FormattedLocator | undefined =>
  list.find((item) => item.label === label)

describe('framework registry', () => {
  it('offers Playwright, Robot Framework, Cucumber Java and Playwright Java', () => {
    expect(FRAMEWORKS.map((f) => f.id)).toEqual(['playwright', 'robot', 'cucumber-java', 'playwright-java'])
  })

  it('looks frameworks up by id and rejects unknown ids', () => {
    expect(frameworkById('robot')?.label).toBe('Robot Framework')
    expect(frameworkById('cypress')).toBeUndefined()
  })
})

describe('Playwright locators', () => {
  const doc = dom(FORM)
  const list = locatorsFor('playwright', pick(doc, '#email'))

  it('prefers test id, then user-facing locators', () => {
    expect(list.map((item) => item.label).slice(0, 4)).toEqual(['Test ID', 'Role', 'Label', 'Placeholder'])
  })

  it('formats each kind', () => {
    expect(codeOf(list, 'Test ID')?.code).toBe("page.getByTestId('email-input')")
    expect(codeOf(list, 'Label')?.code).toBe("page.getByLabel('Email')")
    expect(codeOf(list, 'Placeholder')?.code).toBe("page.getByPlaceholder('you@example.com')")
    expect(codeOf(list, 'ID')?.code).toBe("page.locator('#email')")
    expect(codeOf(list, 'Name')?.code).toBe("page.locator('[name=\"email\"]')")
  })

  it('reports how many elements each locator matches', () => {
    expect(codeOf(list, 'Test ID')?.matches).toBe(1)
    expect(codeOf(list, 'Label')?.matches).toBe(1)
  })

  it('builds a role locator with the accessible name', () => {
    const button = locatorsFor('playwright', pick(doc, 'button[type=submit]'))
    expect(codeOf(button, 'Role')?.code).toBe("page.getByRole('button', { name: 'Sign in' })")
    expect(codeOf(button, 'Role')?.matches).toBe(1)
    expect(codeOf(button, 'Text')?.code).toBe("page.getByText('Sign in')")
  })

  it('flags a locator that is not unique', () => {
    const cancel = locatorsFor('playwright', pick(doc, 'button[type=button]'))
    expect(codeOf(cancel, 'CSS (class)')?.code).toBe("page.locator('button.btn')")
    expect(codeOf(cancel, 'CSS (class)')?.matches).toBe(2)
  })

  it('covers alt text and title', () => {
    expect(codeOf(locatorsFor('playwright', pick(doc, 'img')), 'Alt text')?.code).toBe("page.getByAltText('Company logo')")
    expect(codeOf(locatorsFor('playwright', pick(doc, 'a')), 'Title')?.code).toBe("page.getByTitle('Reset it')")
  })

  it('does not count text from the document head (e.g. <title>)', () => {
    const page = parseHTML(
      '<!doctype html><html><head><title>Sign in - Shop</title></head><body><button>Sign in</button></body></html>',
    ).document
    expect(codeOf(locatorsFor('playwright', pick(page, 'button')), 'Text')?.matches).toBe(1)
  })

  it('uses a CSS fallback that is unique', () => {
    const css = codeOf(list, 'CSS')
    expect(css?.matches).toBe(1)
  })

  it('emits an xpath locator', () => {
    expect(codeOf(list, 'XPath')?.code).toBe("page.locator('xpath=//*[@id=\"email\"]')")
  })

  it('escapes quotes and backslashes in string arguments', () => {
    const tricky = dom('<button>It\'s a \\ test</button>')
    const text = codeOf(locatorsFor('playwright', pick(tricky, 'button')), 'Text')
    expect(text?.code).toBe("page.getByText('It\\'s a \\\\ test')")
  })

  it('escapes carriage returns and form feeds in JS strings', () => {
    const tricky = dom('<input id="a" placeholder="a&#13;b&#12;c">')
    expect(codeOf(locatorsFor('playwright', pick(tricky, 'input')), 'Placeholder')?.code).toBe(
      "page.getByPlaceholder('a\\rb\\fc')",
    )
  })

  it('wraps non-default test id attributes in a css locator', () => {
    const other = dom('<button data-cy="save">Save</button>')
    expect(codeOf(locatorsFor('playwright', pick(other, 'button')), 'Test ID')?.code).toBe(
      "page.locator('[data-cy=\"save\"]')",
    )
  })
})

describe('Robot Framework locators', () => {
  const doc = dom(FORM)
  const list = locatorsFor('robot', pick(doc, '#email'))

  it('uses SeleniumLibrary strategy prefixes', () => {
    expect(codeOf(list, 'ID')?.code).toBe('id:email')
    expect(codeOf(list, 'Name')?.code).toBe('name:email')
    expect(codeOf(list, 'Test ID')?.code).toBe('css:[data-testid="email-input"]')
    expect(codeOf(list, 'Placeholder')?.code).toBe('css:[placeholder="you@example.com"]')
    expect(codeOf(list, 'XPath')?.code).toBe('xpath://*[@id="email"]')
  })

  it('omits locators SeleniumLibrary cannot express', () => {
    expect(codeOf(list, 'Role')).toBeUndefined()
    expect(codeOf(list, 'Label')).toBeUndefined()
  })

  it('offers link text for anchors', () => {
    const link = locatorsFor('robot', pick(doc, 'a'))
    expect(codeOf(link, 'Link text')?.code).toBe('link:Forgot password?')
    expect(codeOf(link, 'Link text')?.matches).toBe(1)
  })

  it('matches visible text with xpath', () => {
    const button = locatorsFor('robot', pick(doc, 'button[type=submit]'))
    expect(codeOf(button, 'Text')?.code).toBe('xpath://button[normalize-space(.)="Sign in"]')
  })

  it('escapes Robot variable syntax and runs of spaces', () => {
    const tricky = dom('<input id="a" placeholder="cost ${x}  now">')
    expect(codeOf(locatorsFor('robot', pick(tricky, 'input')), 'Placeholder')?.code).toBe(
      'css:[placeholder="cost \\${x} \\ now"]',
    )
  })

  it('matches text containing a non-breaking space (xpath normalize-space ignores NBSP)', () => {
    const nbsp = dom('<button>Save now</button>')
    const text = codeOf(locatorsFor('robot', pick(nbsp, 'button')), 'Text')
    expect(text?.code).toBe('xpath://button[normalize-space(translate(., " ", " "))="Save now"]')
  })

  it('addresses namespaced tags by name() in text xpath', () => {
    const word = dom('<o:p>Hello</o:p>')
    const text = codeOf(locatorsFor('robot', pick(word, 'body > *')), 'Text')
    expect(text?.code).toBe(`xpath://*[name()='o:p'][normalize-space(.)="Hello"]`)
  })

  it('escapes tabs, CR and LF so Robot does not treat them as separators', () => {
    const tricky = dom('<input id="a" placeholder="a\tb">')
    expect(codeOf(locatorsFor('robot', pick(tricky, 'input')), 'Placeholder')?.code).toBe(
      'css:[placeholder="a\\tb"]',
    )
  })

  it('counts exact attribute matches', () => {
    expect(codeOf(list, 'Test ID')?.matches).toBe(1)
  })
})

describe('Cucumber Java locators', () => {
  const doc = dom(FORM)
  const list = locatorsFor('cucumber-java', pick(doc, '#email'))

  it('uses Selenium By strategies', () => {
    expect(codeOf(list, 'ID')?.code).toBe('driver.findElement(By.id("email"))')
    expect(codeOf(list, 'Name')?.code).toBe('driver.findElement(By.name("email"))')
    expect(codeOf(list, 'Test ID')?.code).toBe('driver.findElement(By.cssSelector("[data-testid=\\"email-input\\"]"))')
    expect(codeOf(list, 'XPath')?.code).toBe('driver.findElement(By.xpath("//*[@id=\\"email\\"]"))')
    expect(codeOf(list, 'Test ID')?.matches).toBe(1)
  })

  it('omits locators Selenium cannot express', () => {
    expect(codeOf(list, 'Role')).toBeUndefined()
    expect(codeOf(list, 'Label')).toBeUndefined()
  })

  it('offers link text and visible-text xpath', () => {
    expect(codeOf(locatorsFor('cucumber-java', pick(doc, 'a')), 'Link text')?.code).toBe(
      'driver.findElement(By.linkText("Forgot password?"))',
    )
    expect(codeOf(locatorsFor('cucumber-java', pick(doc, 'button[type=submit]')), 'Text')?.code).toBe(
      'driver.findElement(By.xpath("//button[normalize-space(.)=\\"Sign in\\"]"))',
    )
  })

  it('escapes backslashes, quotes and control characters in Java strings', () => {
    const tricky = dom('<input id="a" placeholder="a\\b\tc">')
    expect(codeOf(locatorsFor('cucumber-java', pick(tricky, 'input')), 'Placeholder')?.code).toBe(
      'driver.findElement(By.cssSelector("[placeholder=\\"a\\\\\\\\b\\tc\\"]"))',
    )
  })
})

describe('Playwright Java locators', () => {
  const doc = dom(FORM)
  const list = locatorsFor('playwright-java', pick(doc, '#email'))

  it('formats each kind with Java string literals', () => {
    expect(codeOf(list, 'Test ID')?.code).toBe('page.getByTestId("email-input")')
    expect(codeOf(list, 'Label')?.code).toBe('page.getByLabel("Email")')
    expect(codeOf(list, 'Placeholder')?.code).toBe('page.getByPlaceholder("you@example.com")')
    expect(codeOf(list, 'ID')?.code).toBe('page.locator("#email")')
    expect(codeOf(list, 'Name')?.code).toBe('page.locator("[name=\\"email\\"]")')
    expect(codeOf(list, 'XPath')?.code).toBe('page.locator("xpath=//*[@id=\\"email\\"]")')
    expect(codeOf(list, 'Test ID')?.matches).toBe(1)
  })

  it('builds a role locator with AriaRole and GetByRoleOptions', () => {
    const button = locatorsFor('playwright-java', pick(doc, 'button[type=submit]'))
    expect(codeOf(button, 'Role')?.code).toBe(
      'page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Sign in"))',
    )
    expect(codeOf(button, 'Role')?.matches).toBe(1)
    expect(codeOf(button, 'Text')?.code).toBe('page.getByText("Sign in")')
  })

  it('covers alt text and title', () => {
    expect(codeOf(locatorsFor('playwright-java', pick(doc, 'img')), 'Alt text')?.code).toBe(
      'page.getByAltText("Company logo")',
    )
    expect(codeOf(locatorsFor('playwright-java', pick(doc, 'a')), 'Title')?.code).toBe('page.getByTitle("Reset it")')
  })

  it('wraps non-default test id attributes in a css locator', () => {
    const other = dom('<button data-cy="save">Save</button>')
    expect(codeOf(locatorsFor('playwright-java', pick(other, 'button')), 'Test ID')?.code).toBe(
      'page.locator("[data-cy=\\"save\\"]")',
    )
  })

  it('escapes quotes and backslashes', () => {
    const tricky = dom('<button>Say "hi" \\ now</button>')
    expect(codeOf(locatorsFor('playwright-java', pick(tricky, 'button')), 'Text')?.code).toBe(
      'page.getByText("Say \\"hi\\" \\\\ now")',
    )
  })
})

describe('locatorsFor', () => {
  it('returns nothing for an unknown framework', () => {
    expect(locatorsFor('cypress', pick(dom('<p>x</p>'), 'p'))).toEqual([])
  })
})
