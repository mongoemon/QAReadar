import type { FileKind } from '../lib/fileAccess'
import { t } from '../lib/i18n'
import type { Starter } from '../lib/samples'
import { createSplits } from './text/splits'
import type { TabController } from './types'

const KIND: FileKind = {
  description: 'Text',
  mime: 'text/plain',
  extensions: [
    'txt', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'env', 'properties', 'toml',
    'yaml', 'yml', 'xml', 'sql', 'sh', 'bat', 'ps1',
  ],
}

/** The Text tab: editor splits (see `text/`) behind the app's tab interface. */
export function createTextTab(starter?: Starter): TabController {
  const listeners: Array<() => void> = []
  const splits = createSplits(() => listeners.forEach((listener) => listener()))
  if (starter) splits.active().open({ name: starter.fileName, text: starter.text, handle: null, sample: true })

  return {
    id: 'text',
    get label() {
      return t('tab.text')
    },
    kind: KIND,
    multiDoc: true,
    element: splits.element,
    commands: splits.commands,
    open: (file) => splits.active().open(file),
    snapshot: () => splits.active().snapshot(),
    markSaved: (name, handle) => splits.active().markSaved(name, handle),
    isDirty: splits.isDirty,
    onChange(listener: () => void): void {
      listeners.push(listener)
    },
  }
}
