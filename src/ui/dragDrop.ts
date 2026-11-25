// Opening files by dropping them anywhere on the app.
import { readFile, type FileHandleLike, type OpenedFile } from '../lib/fileAccess'

export interface DropHost {
  /** Run an async action, reporting its errors. */
  run(action: () => Promise<void>): void
  open(file: OpenedFile, target: EventTarget | null): void
}

interface DroppedItem {
  readonly file: File
  readonly handle: Promise<FileHandleLike | null>
}

/** Must run synchronously inside the drop event: DataTransfer items expire afterwards. */
function collectDropped(transfer: DataTransfer): DroppedItem[] {
  return [...transfer.items].flatMap((item): DroppedItem[] => {
    const file = item.getAsFile()
    if (!file) return []
    const getHandle = (item as unknown as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle
    const handle = getHandle
      ? getHandle.call(item).then((h) => ((h as { kind?: string } | null)?.kind === 'file' ? (h as FileHandleLike) : null), () => null)
      : Promise.resolve(null)
    return [{ file, handle }]
  })
}

const carriesFiles = (ev: DragEvent): boolean => ev.dataTransfer?.types.includes('Files') ?? false

function openDropped(host: DropHost, transfer: DataTransfer, target: EventTarget | null): void {
  const dropped = collectDropped(transfer)
  host.run(async () => {
    for (const { file, handle } of dropped) host.open(await readFile(file, await handle), target)
  })
}

export function attachFileDrop(target: Window, host: DropHost): void {
  // Capture phase: file drops must reach us before the editors. Otherwise the WYSIWYG editor
  // (ProseMirror + Toast UI) handles them itself — e.g. it embeds a dropped image as a multi-MB
  // base64 data URL and stops propagation, which can hang the page.
  // Text/HTML drags (moving a selection inside an editor) are left alone.
  target.addEventListener(
    'dragover',
    (ev) => {
      ev.preventDefault()
      if (!carriesFiles(ev)) return
      ev.stopPropagation()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
    },
    true,
  )
  target.addEventListener(
    'drop',
    (ev) => {
      if (!carriesFiles(ev) || !ev.dataTransfer) return
      ev.preventDefault()
      ev.stopPropagation()
      openDropped(host, ev.dataTransfer, ev.target)
    },
    true,
  )
  // Anything else that reaches the window unhandled must not make the browser navigate away.
  target.addEventListener('drop', (ev) => ev.preventDefault())
}
