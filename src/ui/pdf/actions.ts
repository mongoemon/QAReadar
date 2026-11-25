// The long-running toolbar actions: the export menu and inserting another PDF.
import { openTextFile } from '../../lib/fileAccess'
import { t } from '../../lib/i18n'
import { showMenu } from '../menu'
import { loadPdf, type PDFDocumentProxy } from '../pdfEngine'
import { exportAllImages, exportPageImage, exportPdfCopy, exportText, PDF_KIND, type ExportInput } from '../pdfExportActions'
import { errorMessage, toast } from '../toast'

export interface ActionHost {
  exportInput(): ExportInput
  /** Index of the page being shown. */
  current(): number
  finishEditing(): void
  /** An action started or ended: show it and update the toolbar. */
  busyChanged(busy: boolean): void
  /** Add the pages of another PDF at the end and show the first of them. */
  addSource(bytes: Uint8Array, doc: PDFDocumentProxy): void
}

export interface Actions {
  isBusy(): boolean
  openExportMenu(anchor: HTMLElement): void
  insertPdf(): void
}

export function createActions(host: ActionHost): Actions {
  let busy = false

  /** One action at a time; errors become toasts. */
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    host.busyChanged(true)
    try {
      await action()
    } catch (error) {
      toast(errorMessage(error), true)
    } finally {
      busy = false
      host.busyChanged(false)
    }
  }

  /** Run an export that reports the name of the file it wrote. */
  const job = (action: () => Promise<string | null>) => (): void =>
    void run(async () => {
      const saved = await action()
      if (saved) toast(t('pdf.exported', { name: saved }))
    })

  const exportEveryPage = (): void =>
    void run(async () => {
      const count = await exportAllImages(host.exportInput())
      if (count !== null) toast(t('pdf.exportedMany', { n: count }))
    })

  function openExportMenu(anchor: HTMLElement): void {
    host.finishEditing()
    const at = host.current()
    const input = host.exportInput
    showMenu(
      [
        { label: t('pdf.exp.pdf'), icon: 'filePdf', run: job(() => exportPdfCopy(input())) },
        { label: t('pdf.exp.png'), icon: 'fileText', run: job(() => exportPageImage(input(), at, false)) },
        { label: t('pdf.exp.jpg'), icon: 'fileText', run: job(() => exportPageImage(input(), at, true)) },
        { label: t('pdf.exp.allPng'), icon: 'fileText', run: exportEveryPage },
        { label: t('pdf.exp.txt'), icon: 'notepad', run: job(() => exportText(input(), false)) },
        { label: t('pdf.exp.md'), icon: 'notepad', run: job(() => exportText(input(), true)) },
      ],
      anchor,
      t('pdf.export'),
    )
  }

  const insertPdf = (): void =>
    void run(async () => {
      const file = await openTextFile([PDF_KIND])
      if (!file) return
      if (!file.bytes) throw new Error(t('msg.unsupported', { name: file.name }))
      host.addSource(file.bytes, await loadPdf(file.bytes))
    })

  return { isBusy: () => busy, openExportMenu, insertPdf }
}
