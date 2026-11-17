import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_FILE_BYTES,
  downloadText,
  hasReadPermission,
  openTextFile,
  readFile,
  readHandle,
  saveTextFile,
  statHandle,
  type FileHandleLike,
  type FileKind,
} from './fileAccess'

const MD: FileKind = { description: 'Markdown', mime: 'text/markdown', extensions: ['md', 'markdown'] }

const fileOf = (text: string, name = 'a.md', lastModified = 1000) => new File([text], name, { lastModified })

const notFound = () => new DOMException('gone', 'NotFoundError')

interface FakeHandleOptions {
  file?: File | (() => File)
  permission?: PermissionState | 'throw'
  request?: PermissionState
}

function fakeHandle(options: FakeHandleOptions = {}) {
  const written: string[] = []
  const handle = {
    name: 'a.md',
    getFile: vi.fn(async () => {
      const f = options.file ?? fileOf('hello')
      return typeof f === 'function' ? f() : f
    }),
    createWritable: vi.fn(async () => ({
      write: async (data: string) => void written.push(data),
      close: vi.fn(async () => {}),
    })),
    ...(options.permission === undefined
      ? {}
      : {
          queryPermission: vi.fn(async () => {
            if (options.permission === 'throw') throw new Error('nope')
            return options.permission as PermissionState
          }),
          requestPermission: vi.fn(async () => options.request ?? 'denied'),
        }),
  }
  return { handle, written }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('readFile', () => {
  it('returns name, text, handle and lastModified', async () => {
    const { handle } = fakeHandle()
    expect(await readFile(fileOf('# hi', 'x.md', 77), handle)).toEqual({
      name: 'x.md',
      text: '# hi',
      handle,
      lastModified: 77,
    })
  })

  it('rejects files over the size limit with a readable message', async () => {
    const big = { size: MAX_FILE_BYTES + 1, name: 'big.md' } as File
    await expect(readFile(big, null)).rejects.toThrow('File is too large (20.0 MB, max 20 MB)')
  })

  it('accepts a file exactly at the limit', async () => {
    const edge = { size: MAX_FILE_BYTES, name: 'e.md', lastModified: 1, text: async () => 'ok' } as File
    expect((await readFile(edge, null)).text).toBe('ok')
  })
})

describe('hasReadPermission', () => {
  it('assumes permission when the browser has no permission API', async () => {
    expect(await hasReadPermission(fakeHandle().handle, false)).toBe(true)
  })

  it('is granted without prompting when already granted', async () => {
    const { handle } = fakeHandle({ permission: 'granted' })
    expect(await hasReadPermission(handle, true)).toBe(true)
    expect(handle.requestPermission).not.toHaveBeenCalled()
  })

  it('never prompts from background checks', async () => {
    const { handle } = fakeHandle({ permission: 'prompt', request: 'granted' })
    expect(await hasReadPermission(handle, false)).toBe(false)
    expect(handle.requestPermission).not.toHaveBeenCalled()
  })

  it('prompts when allowed and reports the answer', async () => {
    const yes = fakeHandle({ permission: 'prompt', request: 'granted' }).handle
    const no = fakeHandle({ permission: 'prompt', request: 'denied' }).handle
    expect(await hasReadPermission(yes, true)).toBe(true)
    expect(await hasReadPermission(no, true)).toBe(false)
  })

  it('treats a handle without requestPermission as not granted', async () => {
    const { handle } = fakeHandle({ permission: 'prompt' })
    const partial = { ...handle, requestPermission: undefined }
    expect(await hasReadPermission(partial, true)).toBe(false)
  })

  it('treats a throwing permission API as denied', async () => {
    expect(await hasReadPermission(fakeHandle({ permission: 'throw' }).handle, true)).toBe(false)
  })
})

describe('readHandle', () => {
  it('re-reads the file through its handle', async () => {
    const { handle } = fakeHandle({ file: fileOf('fresh', 'a.md', 5) })
    expect(await readHandle(handle, true)).toEqual({
      status: 'ok',
      file: { name: 'a.md', text: 'fresh', handle, lastModified: 5 },
    })
  })

  it('reports denied without touching the file', async () => {
    const { handle } = fakeHandle({ permission: 'denied' })
    expect(await readHandle(handle, true)).toEqual({ status: 'denied' })
    expect(handle.getFile).not.toHaveBeenCalled()
  })

  it('reports a moved/deleted file as missing instead of throwing', async () => {
    const { handle } = fakeHandle({
      file: () => {
        throw notFound()
      },
    })
    expect(await readHandle(handle, false)).toEqual({ status: 'missing' })
  })

  it('rethrows unexpected errors', async () => {
    const { handle } = fakeHandle({
      file: () => {
        throw new Error('disk on fire')
      },
    })
    await expect(readHandle(handle, false)).rejects.toThrow('disk on fire')
  })

  it('rethrows the too-large error from readFile', async () => {
    const { handle } = fakeHandle({ file: { size: MAX_FILE_BYTES + 1, name: 'b' } as File })
    await expect(readHandle(handle, false)).rejects.toThrow(/too large/)
  })
})

describe('statHandle', () => {
  it('returns lastModified without reading the text', async () => {
    const file = fileOf('x', 'a.md', 4242)
    const textSpy = vi.spyOn(file, 'text')
    expect(await statHandle(fakeHandle({ file }).handle)).toBe(4242)
    expect(textSpy).not.toHaveBeenCalled()
  })

  it('is unknown when permission has lapsed (and does not prompt)', async () => {
    const { handle } = fakeHandle({ permission: 'prompt', request: 'granted' })
    expect(await statHandle(handle)).toBe('unknown')
    expect(handle.requestPermission).not.toHaveBeenCalled()
  })

  it('is missing for NotFoundError and unknown for anything else', async () => {
    const gone = fakeHandle({
      file: () => {
        throw notFound()
      },
    }).handle
    const broken = fakeHandle({
      file: () => {
        throw new Error('busy')
      },
    }).handle
    expect(await statHandle(gone)).toBe('missing')
    expect(await statHandle(broken)).toBe('unknown')
  })
})

describe('openTextFile with the File System Access API', () => {
  it('opens the picked file with the requested types', async () => {
    const { handle } = fakeHandle({ file: fileOf('picked', 'p.md', 9) })
    const showOpenFilePicker = vi.fn(async () => [handle])
    vi.stubGlobal('window', { showOpenFilePicker })
    expect(await openTextFile([MD])).toEqual({ name: 'p.md', text: 'picked', handle, lastModified: 9 })
    expect(showOpenFilePicker).toHaveBeenCalledWith({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
      multiple: false,
    })
  })

  it('returns null when the picker returns nothing or is cancelled', async () => {
    vi.stubGlobal('window', { showOpenFilePicker: async () => [] })
    expect(await openTextFile([MD])).toBeNull()
    vi.stubGlobal('window', {
      showOpenFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
    })
    expect(await openTextFile([MD])).toBeNull()
  })

  it('propagates other errors', async () => {
    vi.stubGlobal('window', {
      showOpenFilePicker: async () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    await expect(openTextFile([MD])).rejects.toThrow('blocked')
  })
})

/** A stand-in <input type=file> that lets the test fire change/cancel. */
function stubFileInput() {
  const listeners = new Map<string, () => void>()
  const input = {
    type: '',
    accept: '',
    files: null as File[] | null,
    addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
    click: vi.fn(),
    fire: (type: string) => listeners.get(type)?.(),
  }
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { createElement: () => input })
  return input
}

describe('openTextFile fallback (<input type=file>)', () => {
  it('configures the input and reads the chosen file', async () => {
    const input = stubFileInput()
    const pending = openTextFile([MD])
    expect(input.type).toBe('file')
    expect(input.accept).toBe('.md,.markdown')
    expect(input.click).toHaveBeenCalled()
    input.files = [fileOf('typed', 'in.md', 3)]
    input.fire('change')
    expect(await pending).toEqual({ name: 'in.md', text: 'typed', handle: null, lastModified: 3 })
  })

  it('resolves null on cancel or an empty selection', async () => {
    const input = stubFileInput()
    const cancelled = openTextFile([MD])
    input.fire('cancel')
    expect(await cancelled).toBeNull()

    const empty = openTextFile([MD])
    input.files = []
    input.fire('change')
    expect(await empty).toBeNull()
  })

  it('rejects when the chosen file is too large', async () => {
    const input = stubFileInput()
    const pending = openTextFile([MD])
    input.files = [{ size: MAX_FILE_BYTES + 1, name: 'big' } as File]
    input.fire('change')
    await expect(pending).rejects.toThrow(/too large/)
  })
})

function stubDownloadDom() {
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
  const append = vi.fn()
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { createElement: () => anchor, body: { append } })
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { anchor, append, createObjectURL, revokeObjectURL }
}

describe('downloadText', () => {
  it('downloads via a temporary link and revokes the URL later', async () => {
    vi.useFakeTimers()
    const { anchor, append, createObjectURL, revokeObjectURL } = stubDownloadDom()
    downloadText('n.md', 'body', 'text/markdown')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(await blob.text()).toBe('body')
    expect(anchor).toMatchObject({ href: 'blob:x', download: 'n.md' })
    expect(append).toHaveBeenCalledWith(anchor)
    expect(anchor.click).toHaveBeenCalled()
    expect(anchor.remove).toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })
})

describe('saveTextFile', () => {
  const doc = (handle: FileHandleLike | null) => ({ name: 'doc.md', text: 'content', handle })

  it('falls back to a download when there is no save picker', async () => {
    vi.useFakeTimers()
    const { anchor } = stubDownloadDom()
    expect(await saveTextFile(doc(null), MD, false)).toEqual({ name: 'doc.md', handle: null })
    expect(anchor.download).toBe('doc.md')
  })

  it('writes back to the existing handle without asking', async () => {
    const { handle, written } = fakeHandle()
    const showSaveFilePicker = vi.fn()
    vi.stubGlobal('window', { showSaveFilePicker })
    expect(await saveTextFile(doc(handle), MD, false)).toEqual({ name: 'a.md', handle })
    expect(written).toEqual(['content'])
    expect(showSaveFilePicker).not.toHaveBeenCalled()
  })

  it('asks for a location for new docs or "Save as"', async () => {
    const existing = fakeHandle().handle
    const target = fakeHandle()
    const showSaveFilePicker = vi.fn(async () => target.handle)
    vi.stubGlobal('window', { showSaveFilePicker })

    await saveTextFile(doc(null), MD, false)
    await saveTextFile(doc(existing), MD, true)
    expect(showSaveFilePicker).toHaveBeenCalledTimes(2)
    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'doc.md',
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
    })
    expect(target.written).toEqual(['content', 'content'])
    expect(existing.createWritable).not.toHaveBeenCalled()
  })

  it('returns null when the save dialog is cancelled', async () => {
    vi.stubGlobal('window', {
      showSaveFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
    })
    expect(await saveTextFile(doc(null), MD, false)).toBeNull()
  })

  it('propagates write failures', async () => {
    const { handle } = fakeHandle()
    handle.createWritable.mockRejectedValueOnce(new Error('read-only'))
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn() })
    await expect(saveTextFile(doc(handle), MD, false)).rejects.toThrow('read-only')
  })
})
