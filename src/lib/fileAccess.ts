import { t } from './i18n'

export interface FileKind {
  readonly description: string
  readonly mime: string
  readonly extensions: readonly string[]
}

export interface WritableLike {
  write(data: string): Promise<void>
  close(): Promise<void>
}

export interface FileHandleLike {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<WritableLike>
}

export interface OpenedFile {
  readonly name: string
  readonly text: string
  readonly handle: FileHandleLike | null
  /** File's lastModified at read time; lets a tab detect edits made outside the app. */
  readonly lastModified?: number
  /** Built-in sample document: not worth remembering across reloads. */
  readonly sample?: boolean
}

export interface DocSnapshot {
  readonly name: string
  readonly text: string
  readonly handle: FileHandleLike | null
}

export interface SavedFile {
  readonly name: string
  readonly handle: FileHandleLike | null
}

interface PickerType {
  description: string
  accept: Record<string, string[]>
}

interface PickerApi {
  showOpenFilePicker(options: {
    types: PickerType[]
    multiple: boolean
  }): Promise<FileHandleLike[]>
  showSaveFilePicker(options: {
    suggestedName: string
    types: PickerType[]
  }): Promise<FileHandleLike>
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024

const picker = (): Partial<PickerApi> => window as unknown as Partial<PickerApi>

const isAbort = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'AbortError'

const pickerTypes = (kinds: readonly FileKind[]): PickerType[] =>
  kinds.map((kind) => ({
    description: kind.description,
    accept: { [kind.mime]: kind.extensions.map((ext) => `.${ext}`) },
  }))

export async function readFile(
  file: File,
  handle: FileHandleLike | null,
): Promise<OpenedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      t('msg.tooLarge', { size: (file.size / 1048576).toFixed(1), max: MAX_FILE_BYTES / 1048576 }),
    )
  }
  return { name: file.name, text: await file.text(), handle, lastModified: file.lastModified }
}

interface PermissionHandle extends FileHandleLike {
  queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>
}

/**
 * Read permission for a stored handle. Browsers reset it after a reload; asking again
 * (`prompt: true`) is only allowed from a user gesture, so background checks pass false.
 */
export async function hasReadPermission(handle: FileHandleLike, prompt: boolean): Promise<boolean> {
  const h = handle as PermissionHandle
  if (!h.queryPermission) return true
  try {
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
    return prompt && (await h.requestPermission?.({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

export type HandleRead =
  | { readonly status: 'ok'; readonly file: OpenedFile }
  | { readonly status: 'missing' }
  | { readonly status: 'denied' }

/** Moved, renamed or deleted files surface as NotFoundError from getFile(). */
export const isMissingFileError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'NotFoundError'

/** Re-read a file through its handle without ever throwing for the "file is gone" case. */
export async function readHandle(handle: FileHandleLike, prompt: boolean): Promise<HandleRead> {
  if (!(await hasReadPermission(handle, prompt))) return { status: 'denied' }
  try {
    return { status: 'ok', file: await readFile(await handle.getFile(), handle) }
  } catch (e) {
    if (isMissingFileError(e)) return { status: 'missing' }
    throw e
  }
}

/** Cheap existence/modification probe for background checks (no text read). */
export async function statHandle(handle: FileHandleLike): Promise<number | 'missing' | 'unknown'> {
  if (!(await hasReadPermission(handle, false))) return 'unknown'
  try {
    return (await handle.getFile()).lastModified
  } catch (e) {
    return isMissingFileError(e) ? 'missing' : 'unknown'
  }
}

function openWithInput(kinds: readonly FileKind[]): Promise<OpenedFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = kinds.flatMap((kind) => kind.extensions.map((ext) => `.${ext}`)).join(',')
    input.addEventListener('cancel', () => resolve(null))
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      readFile(file, null).then(resolve, reject)
    })
    input.click()
  })
}

export async function openTextFile(kinds: readonly FileKind[]): Promise<OpenedFile | null> {
  const api = picker()
  if (!api.showOpenFilePicker) return openWithInput(kinds)
  try {
    const [handle] = await api.showOpenFilePicker({
      types: pickerTypes(kinds),
      multiple: false,
    })
    if (!handle) return null
    return await readFile(await handle.getFile(), handle)
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

export function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function saveTextFile(
  doc: DocSnapshot,
  kind: FileKind,
  forceNew: boolean,
): Promise<SavedFile | null> {
  const api = picker()
  if (!api.showSaveFilePicker) {
    downloadText(doc.name, doc.text, kind.mime)
    return { name: doc.name, handle: null }
  }
  try {
    const handle =
      !forceNew && doc.handle
        ? doc.handle
        : await api.showSaveFilePicker({
            suggestedName: doc.name,
            types: pickerTypes([kind]),
          })
    const writable = await handle.createWritable()
    await writable.write(doc.text)
    await writable.close()
    return { name: handle.name, handle }
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}
