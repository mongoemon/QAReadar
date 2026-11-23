import type { Command } from '../lib/commands'
import type {
  DocSnapshot,
  FileHandleLike,
  FileKind,
  OpenedFile,
} from '../lib/fileAccess'

/** Contract every top-level tab implements so main.ts can drive open/save generically. */
export interface TabController {
  readonly id: string
  readonly label: string
  readonly kind: FileKind
  /** Extra file extensions the tab can open (and convert) but not save as. */
  readonly extraExtensions?: readonly string[]
  /** True when open() adds a document instead of replacing the current one. */
  readonly multiDoc?: boolean
  readonly element: HTMLElement
  /** Tab-specific entries for the command palette; their ids are also what shortcuts bind to. */
  commands?(): Command[]
  setDark?(dark: boolean): void
  open(file: OpenedFile): void
  /** Take a file dropped onto `target` inside this tab (e.g. onto one side of a diff); false = not handled. */
  acceptDrop?(file: OpenedFile, target: EventTarget | null): boolean
  snapshot(): DocSnapshot
  markSaved(name: string, handle: FileHandleLike | null): void
  isDirty(): boolean
  onChange(listener: () => void): void
}
