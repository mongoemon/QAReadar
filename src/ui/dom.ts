export type Child = Node | string

/** Tiny hyperscript helper. Uses textContent semantics for strings (no innerHTML). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') node.className = value
    else node.setAttribute(name, value)
  }
  node.append(...children)
  return node
}
