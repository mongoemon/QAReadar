export interface RecentEntry {
  readonly id: string
  readonly name: string
  readonly tab: string
  /** epoch milliseconds */
  readonly openedAt: number
}

export const makeRecentId = (tab: string, name: string): string => `${tab}:${name}`

/** Newest first, de-duplicated by id, capped at `max`. Never mutates `list`. */
export function pushRecent(
  list: readonly RecentEntry[],
  entry: RecentEntry,
  max: number,
): RecentEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, max)
}
