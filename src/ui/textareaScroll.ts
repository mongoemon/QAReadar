/**
 * Browsers do not scroll a <textarea> to a selection that was set from code, and exposing the
 * caret position needs layout. A hidden mirror with the same text metrics and width gives the
 * pixel offset of any character, including through soft-wrapped lines.
 */

const MIRRORED_STYLES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent', 'textTransform',
] as const

/** Distance in px from the top of the textarea's content to the line holding `offset`. */
function offsetTop(textarea: HTMLTextAreaElement, offset: number): number {
  const computed = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  for (const name of MIRRORED_STYLES) mirror.style[name] = computed[name]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.boxSizing = 'border-box'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.append(document.createTextNode(textarea.value.slice(0, offset)), marker)
  document.body.append(mirror)
  const top = marker.offsetTop
  mirror.remove()
  return top
}

/** Scroll so the line containing `offset` is visible, roughly a third of the way down. */
export function scrollOffsetIntoView(textarea: HTMLTextAreaElement, offset: number): void {
  const top = offsetTop(textarea, offset)
  const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20
  const visibleFrom = textarea.scrollTop
  const visibleTo = visibleFrom + textarea.clientHeight - lineHeight
  if (top >= visibleFrom && top <= visibleTo) return
  textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 3)
}
