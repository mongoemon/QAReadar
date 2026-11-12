export interface Command {
  readonly id: string
  readonly title: string
  readonly hint?: string
  readonly run: () => void
}

/** Returns -1 when `query` is not a subsequence of `title`; higher scores rank first. */
function score(title: string, query: string): number {
  const t = title.toLowerCase()
  const at = t.indexOf(query)
  if (at !== -1) return 1000 - at

  let ti = 0
  let gaps = 0
  for (const ch of query) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    gaps += found - ti
    ti = found + 1
  }
  return 500 - gaps
}

export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...commands]
  return commands
    .map((command, index) => ({ command, index, s: score(command.title, q) }))
    .filter((entry) => entry.s >= 0)
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((entry) => entry.command)
}
