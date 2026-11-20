import showcaseMd from '../../examples/showcase.md?raw'
import showcaseJson from '../../examples/showcase.json?raw'
import loginHtml from '../../examples/login.html?raw'
import manualFeature from '../../examples/manual-login.feature?raw'
import automateFeature from '../../examples/automate-login.feature?raw'
import textTips from '../../examples/text-editor.txt?raw'

export interface Starter {
  readonly fileName: string
  readonly text: string
}

/** Documents preloaded in each editor on first launch. */
export const STARTER_MARKDOWN: Starter = { fileName: 'showcase.md', text: showcaseMd }
export const STARTER_JSON: Starter = { fileName: 'showcase.json', text: showcaseJson }
export const STARTER_HTML: Starter = { fileName: 'login.html', text: loginHtml }
export const STARTER_TEXT: Starter = { fileName: 'text-editor.txt', text: textTips }
/** Diff & Merge tab: a manual test case and its automated counterpart. */
export const STARTER_MERGE: { readonly manual: Starter; readonly automate: Starter } = {
  manual: { fileName: 'manual-login.feature', text: manualFeature },
  automate: { fileName: 'automate-login.feature', text: automateFeature },
}
