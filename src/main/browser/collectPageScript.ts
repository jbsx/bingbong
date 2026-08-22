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
    '[role="option"]',
    'iframe[src]'
  ].join(',')
  // Vimium-style visibility: rect intersection only. Overlays do NOT hide an
  // element from detection — a covered "background" button is still a real
  // target (the click path activates elements directly when coordinates
  // can't reach them).
  const hasSize = (el) => {
    const rect = el.getBoundingClientRect()
    return rect.width >= 1 && rect.height >= 1
  }
  const rectVisible = (el) => {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (!hasSize(el)) return false
    const rect = el.getBoundingClientRect()
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw
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
  // The topmost open dialog is the page's current interaction layer (consent
  // walls, pop-ups). Its controls are listed even when they sit below the
  // fold inside the dialog's own scroller — the click path scrolls them into
  // view — so the model can target them without a scroll dance.
  const DIALOG_SELECTOR = 'dialog[open], tp-yt-paper-dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  const currentDialogRoot = () => {
    const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter((dialog) => {
      const style = window.getComputedStyle(dialog)
      return dialog.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && hasSize(dialog)
    })
    return dialogs.length > 0 ? dialogs[dialogs.length - 1] : null
  }
  // Challenge widgets (Turnstile, reCAPTCHA) live in cross-origin iframes
  // whose content the top frame cannot read. Listing them (ADR 0007) with
  // their absolute src makes the Blocker visible to read_page. Same-origin
  // frames are page chrome, not Blockers — they stay invisible.
  const crossOriginIframeSrc = (el) => {
    const raw = el.getAttribute('src')
    if (!raw) return null
    try {
      const url = new URL(raw, location.href)
      if (url.origin === location.origin) return null
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      return url.href
    } catch (e) {
      return null
    }
  }
  const collectElements = (dialogRoot) => {
    const dialogElements = []
    const pageElements = []
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (el.tagName === 'INPUT' && el.type === 'hidden') continue
      if (el.tagName === 'IFRAME' && crossOriginIframeSrc(el) === null) continue
      if (dialogRoot !== null && dialogRoot.contains(el)) {
        if (!hasSize(el)) continue
        dialogElements.push(el)
      } else {
        if (!rectVisible(el)) continue
        pageElements.push(el)
      }
    }
    return dialogElements.concat(pageElements).slice(0, 400)
  }
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
  const heading = document.querySelector('h1, [role="heading"][aria-level="1"]')
  const textRoot = document.querySelector('main, article') || document.body
  const digestParts = []
  const headingText = heading ? textOf(heading) : ''
  if (headingText) digestParts.push(headingText)
  if (textRoot) {
    for (const block of textRoot.querySelectorAll('p, li, h2, h3')) {
      const text = textOf(block)
      if (text && text !== headingText && !digestParts.includes(text)) digestParts.push(text)
    }
  }
  const textDigest = digestParts.join('\\n').slice(0, 1800)

  const describeElement = (el, dialogRoot) => {
    const rect = el.getBoundingClientRect()
    const form = formOf(el)
    const formFlags = formFlagsOf(form)
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || (el.hasAttribute('onclick') ? 'button' : null),
      inputType: el.tagName === 'INPUT' ? el.type : null,
      label: labelOf(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      src: el.tagName === 'IFRAME' ? crossOriginIframeSrc(el) : null,
      href: el.getAttribute('href'),
      downloadsFile: el.hasAttribute('download'),
      submitsForm: submitsFormOf(el, form),
      credentialField: isCredentialField(el),
      paymentField: isPaymentField(el),
      inForm: formFlags.inForm,
      formHasCredential: formFlags.formHasCredential,
      formHasPayment: formFlags.formHasPayment,
      layer: dialogRoot !== null && dialogRoot.contains(el) ? 'dialog' : 'page',
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      selectedOption: el.tagName === 'SELECT' && el.selectedOptions.length > 0
        ? textOf(el.selectedOptions[0]).slice(0, 160)
        : null,
      value: typeof el.value === 'string' && !(el.tagName === 'INPUT' && el.type === 'password')
        ? el.value.slice(0, 160)
        : (el.isContentEditable ? textOf(el).slice(0, 160) : null),
      ariaPressed: el.getAttribute('aria-pressed'),
      className: typeof el.className === 'string' ? el.className.slice(0, 160) : ''
    }
  }
  window.__bingbongDescribeElement = (el) => describeElement(el, currentDialogRoot())
  window.__bingbongPageProbe = (targetIndex, targetLabel) => {
    const dialogRoot = currentDialogRoot()
    const refs = collectElements(dialogRoot).slice(0, 75)
    const truncateLabel = (label) => label.length <= 80 ? label : label.slice(0, 79) + '…'
    const labels = refs.map((ref) => truncateLabel(labelOf(ref)))
    const target = labels[targetIndex] === targetLabel ? refs[targetIndex] : null
    return {
      target: target ? describeElement(target, dialogRoot) : null,
      signature: {
        url: location.href,
        title: document.title,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        refCount: refs.length,
        labels,
        dialogOpen: dialogRoot !== null
      }
    }
  }
  const dialogRoot = currentDialogRoot()
  // Dialog controls come first so they survive the collection cap; the order
  // here is exactly what the controller's element registry is keyed by.
  const collected = collectElements(dialogRoot)
  window.__bingbongRefs = collected
  const elements = collected.map((el) => describeElement(el, dialogRoot))
  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: vw,
      height: vh,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      )
    },
    dialogOpen: dialogRoot !== null,
    dialogText: dialogRoot !== null ? textOf(dialogRoot).slice(0, 400) : '',
    textDigest,
    elements
  }
})()`
