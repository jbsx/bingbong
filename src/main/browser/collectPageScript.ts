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
  // Risk facts the gate classifies from. All DOM heuristics (autocomplete
  // tokens, name/id matching, form association) live here; core only reads
  // the folded flags.
  const CREDENTIAL_AUTOCOMPLETE = ['username', 'current-password', 'new-password']
  const PAYMENT_NAME_RE = /card|ccnum|cvc|cvv|expir/i
  const isCredentialField = (el) => {
    if (el.tagName === 'INPUT' && el.type === 'password') return true
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
    return CREDENTIAL_AUTOCOMPLETE.includes(ac)
  }
  const isPaymentField = (el) => {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
    if (ac.startsWith('cc-')) return true
    return PAYMENT_NAME_RE.test(((el.name || '') + ' ' + (el.id || '')).trim())
  }
  const formOf = (el) => el.form || el.closest('form')
  const submitsFormOf = (el, form) => {
    if (!form) return false
    if (el.tagName === 'INPUT') return el.type === 'submit' || el.type === 'image'
    if (el.tagName === 'BUTTON') return !el.type || el.type === 'submit'
    return false
  }
  const formFlagsOf = (form) => {
    if (!form) return { inForm: false, formHasCredential: false, formHasPayment: false }
    let credential = false
    let payment = false
    for (const field of form.querySelectorAll('input,select,textarea')) {
      if (isCredentialField(field)) credential = true
      if (isPaymentField(field)) payment = true
    }
    return { inForm: true, formHasCredential: credential, formHasPayment: payment }
  }
  const elements = []
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (elements.length >= 400) break
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue
    if (!isVisible(el)) continue
    const rect = el.getBoundingClientRect()
    const form = formOf(el)
    const formFlags = formFlagsOf(form)
    elements.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      inputType: el.tagName === 'INPUT' ? el.type : null,
      label: labelOf(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      href: el.getAttribute('href'),
      downloadsFile: el.hasAttribute('download'),
      submitsForm: submitsFormOf(el, form),
      credentialField: isCredentialField(el),
      paymentField: isPaymentField(el),
      inForm: formFlags.inForm,
      formHasCredential: formFlags.formHasCredential,
      formHasPayment: formFlags.formHasPayment
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
