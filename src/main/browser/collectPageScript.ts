// Runs inside the pane's page via Runtime.evaluate. Returns the CollectedPage
// shape consumed by core/browser/snapshot.ts — DOM-specific work (labeling,
// rects, visibility) happens here; numbering/kinds/formatting happen in core.
export const COLLECT_PAGE_SCRIPT = `(() => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const SELECTOR = [
    'a[href]',
    'area[href]',
    'button',
    'input',
    'select',
    'textarea',
    'video',
    'audio',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]'
  ].join(',')
  const isVisible = (el) => {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const rect = el.getBoundingClientRect()
    return (
      rect.width >= 1 &&
      rect.height >= 1 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < vh &&
      rect.left < vw
    )
  }
  const labelOf = (el) => {
    const parts = []
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel) parts.push(ariaLabel)
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      for (const id of labelledBy.split(/\\s+/)) {
        const source = document.getElementById(id)
        if (source && source.textContent) parts.push(source.textContent)
      }
    }
    if (el.labels) {
      for (const label of Array.from(el.labels)) {
        if (label.textContent) parts.push(label.textContent)
      }
    }
    if (el.placeholder) parts.push(el.placeholder)
    if ((el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) || el.tagName === 'BUTTON') {
      if (typeof el.value === 'string' && el.value) parts.push(el.value)
    }
    const text = el.innerText || el.textContent
    if (text) parts.push(text)
    if (el.title) parts.push(el.title)
    return parts.join(' ').replace(/\\s+/g, ' ').trim().slice(0, 300)
  }
  const elements = []
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (elements.length >= 400) break
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue
    if (!isVisible(el)) continue
    const rect = el.getBoundingClientRect()
    elements.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      inputType: el.tagName === 'INPUT' ? el.type : null,
      label: labelOf(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  }
  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: vw,
      height: vh,
      scrollY: window.scrollY,
      scrollHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      )
    },
    elements
  }
})()`
