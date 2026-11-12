/**
 * Turns a parsed page into the `srcdoc` of the sandboxed preview iframe.
 *
 * The iframe itself runs without `allow-scripts`; this adds the parts the sandbox does not cover:
 * a CSP forbidding every subresource, and removal of tags through which pasted HTML could still
 * make the frame navigate or contact a remote host (`<meta http-equiv=refresh>`, `<base>`, and
 * resource-hint links — CSP does not govern a frame's own navigation or DNS/connection hints).
 */

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const RESOURCE_HINT_REL = /\b(prefetch|preconnect|dns-prefetch|prerender|preload|modulepreload)\b/i

function removeNetworkVectors(doc: Document): void {
  for (const meta of doc.querySelectorAll('meta[http-equiv]')) {
    if ((meta.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'refresh') meta.remove()
  }
  for (const base of doc.querySelectorAll('base')) base.remove()
  for (const link of doc.querySelectorAll('link[rel]')) {
    if (RESOURCE_HINT_REL.test(link.getAttribute('rel') ?? '')) link.remove()
  }
}

export function prepareForPreview(doc: Document): string {
  removeNetworkVectors(doc)
  let head = doc.head
  if (!head) {
    head = doc.createElement('head')
    doc.documentElement.prepend(head)
  }
  const meta = doc.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', CSP)
  head.prepend(meta)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}
