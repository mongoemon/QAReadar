import type { FlatNode } from './jsonPath'

export type SearchScope = 'all' | 'key' | 'value'

export interface SearchOptions {
  readonly regex: boolean
  readonly scope: SearchScope
}

export type SearchResult =
  | { readonly ok: true; readonly nodes: readonly FlatNode[] }
  | { readonly ok: false; readonly error: string }

const isContainer = (node: FlatNode): boolean => node.type === 'object' || node.type === 'array'

function buildTest(query: string, regex: boolean): ((s: string) => boolean) | string {
  if (!regex) {
    const needle = query.toLowerCase()
    return (s) => s.toLowerCase().includes(needle)
  }
  try {
    const re = new RegExp(query, 'i')
    return (s) => re.test(s)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export function searchNodes(
  nodes: readonly FlatNode[],
  query: string,
  options: SearchOptions,
): SearchResult {
  if (query === '') return { ok: true, nodes }
  const test = buildTest(query, options.regex)
  if (typeof test === 'string') return { ok: false, error: test }

  const matches = (node: FlatNode): boolean => {
    switch (options.scope) {
      case 'key':
        return test(node.key)
      case 'value':
        return !isContainer(node) && test(node.preview)
      case 'all':
        return test(node.path) || test(node.preview)
    }
  }
  return { ok: true, nodes: nodes.filter(matches) }
}
