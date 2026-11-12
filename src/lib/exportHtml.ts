const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])

const DOCUMENT_CSS = `
:root { color-scheme: light dark; }
body { max-width: 78ch; margin: 2rem auto; padding: 0 1rem; font: 17px/1.7 Georgia, 'Noto Serif Thai', serif; }
h1, h2, h3, h4 { line-height: 1.25; }
pre, code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
pre { padding: 0.8rem 1rem; overflow: auto; background: rgb(127 127 127 / 0.12); }
code { background: rgb(127 127 127 / 0.12); padding: 0.1em 0.3em; }
pre code { background: none; padding: 0; }
blockquote { margin-inline: 0; padding-left: 1rem; border-left: 3px solid rgb(127 127 127 / 0.5); }
table { border-collapse: collapse; }
th, td { padding: 0.3rem 0.7rem; border: 1px solid rgb(127 127 127 / 0.5); }
img { max-width: 100%; }
@media print { body { max-width: none; margin: 0; } }
`

/** Wraps already-sanitised body HTML in a standalone document. Only the title is escaped here. */
export function buildHtmlDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}
