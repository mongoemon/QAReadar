import { parseHTML } from 'linkedom'
import { describe, expect, it } from 'vitest'
import { prepareForPreview } from './previewDoc'

const prepare = (html: string): string => prepareForPreview(parseHTML(html).document)

describe('prepareForPreview', () => {
  it('injects a CSP that blocks network, base and form targets', () => {
    const out = prepare('<!doctype html><html><head></head><body><p>x</p></body></html>')
    expect(out).toContain('http-equiv="Content-Security-Policy"')
    expect(out).toContain("default-src 'none'")
    expect(out).toContain("base-uri 'none'")
    expect(out).toContain("form-action 'none'")
  })

  it('removes meta refresh, which could navigate the frame to a remote URL', () => {
    const out = prepare(
      '<html><head><meta http-equiv="Refresh" content="0;url=https://evil.example/x"></head><body>hi</body></html>',
    )
    expect(out.toLowerCase()).not.toContain('refresh')
    expect(out).not.toContain('evil.example')
  })

  it('removes <base> and prefetch-style links', () => {
    const out = prepare(
      '<html><head><base href="https://evil.example/"><link rel="preconnect" href="https://evil.example">' +
        '<link rel="dns-prefetch" href="//evil.example"><link rel="stylesheet" href="a.css"></head><body></body></html>',
    )
    expect(out).not.toContain('<base')
    expect(out).not.toContain('preconnect')
    expect(out).not.toContain('dns-prefetch')
  })

  it('keeps the page body intact', () => {
    expect(prepare('<html><body><button id="go">Go</button></body></html>')).toContain('<button id="go">Go</button>')
  })

  it('starts with a doctype so the preview renders in standards mode', () => {
    expect(prepare('<html><body><p>x</p></body></html>').startsWith('<!doctype html>')).toBe(true)
  })
})
