import showcaseMd from '../../examples/showcase.md?raw'
import showcaseJson from '../../examples/showcase.json?raw'
import loginHtml from '../../examples/login.html?raw'

export interface Starter {
  readonly fileName: string
  readonly text: string
}

/** Documents preloaded in each editor on first launch. */
export const STARTER_MARKDOWN: Starter = { fileName: 'showcase.md', text: showcaseMd }
export const STARTER_JSON: Starter = { fileName: 'showcase.json', text: showcaseJson }
export const STARTER_HTML: Starter = { fileName: 'login.html', text: loginHtml }
