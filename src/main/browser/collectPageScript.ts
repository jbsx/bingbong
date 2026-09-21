import { MAX_COLLECTED_PAGE_TEXT } from '../../core/browser/pageText'
import { CONSENT_LABEL_RE } from '../../core/browser/dialogPolicy'
import type { CoverProbe } from '../../core/browser/actionOutcome'
import { MAX_COVER_REFS } from '../../core/browser/snapshot'

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
  // ADR 0062: nothing inside an inert subtree is focusable or clickable by
  // the platform's definition, so it is never a target — a closed drawer
  // styled open but marked inert lists nothing. That is the one thing the
  // rect rule learns: opacity and clipping stay act-time facts.
  const insideInert = (el) => el.closest('[inert]') !== null
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
  // A card token marks a Payment Field only where no letter precedes it in
  // the name/id, so card_number, billing_card and cardNumber match while
  // postcard, discard and wildcard do not — nor does a camelCase joint such as
  // billingCard (#237).
  const PAYMENT_NAME_RE = /(?:^|[^a-z])(?:card|ccnum|cvc|cvv|expir)/i
  // Buttons, toggles, hidden and file inputs take no typed text. Neither a
  // search field nor a Payment Field can be one, whatever its name or id: a
  // facet checkbox named "Postcard" or filter_materials[card] is not a card
  // number (#237).
  const VALUELESS_INPUT_TYPES = ['submit', 'button', 'reset', 'image', 'hidden', 'checkbox', 'radio', 'file']
  const isValuelessInput = (el) => el.tagName === 'INPUT' && VALUELESS_INPUT_TYPES.includes((el.type || 'text').toLowerCase())
  // Search-flavored fields (ADR 0015): type="search", or the identifying
  // attributes matching /search|query|^q$/i — each attribute tested whole, so
  // Google's name=q matches while "qq" or a submit button named "search" do
  // not leak in (button/hidden types are excluded below regardless). The
  // attribute clause also reaches SPA search boxes that are not form controls:
  // contenteditable and role=searchbox/textbox hosts qualify through their
  // id/aria-label, so a click on their form's submit is exempt alike.
  const SEARCH_HINT_RE = /search|query|^q$/i
  const isEditableField = (el) => {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true
    if (el.isContentEditable) return true
    const role = el.getAttribute('role')
    return role === 'searchbox' || role === 'textbox'
  }
  const isSearchField = (el) => {
    if (!isEditableField(el)) return false
    if (isValuelessInput(el)) return false
    if (el.tagName === 'INPUT' && el.type === 'search') return true
    const hints = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder]
    return hints.some((hint) => typeof hint === 'string' && hint !== '' && SEARCH_HINT_RE.test(hint))
  }
  const isCredentialField = (el) => {
    if (el.tagName === 'INPUT' && el.type === 'password') return true
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
    return CREDENTIAL_AUTOCOMPLETE.includes(ac)
  }
  // A select (expiry month/year) and a tel input stay eligible.
  const isPaymentField = (el) => {
    if (isValuelessInput(el)) return false
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
    if (!form) return { inForm: false, formHasCredential: false, formHasPayment: false, formHasSearch: false }
    let credential = false
    let payment = false
    let search = false
    for (const field of form.querySelectorAll('input,select,textarea,[contenteditable="true"],[role="searchbox"],[role="textbox"]')) {
      if (isCredentialField(field)) credential = true
      if (isPaymentField(field)) payment = true
      if (isSearchField(field)) search = true
    }
    return { inForm: true, formHasCredential: credential, formHasPayment: payment, formHasSearch: search }
  }
  // The topmost open dialog is the page's current interaction layer (consent
  // walls, pop-ups). Its controls are listed even when they sit below the
  // fold inside the dialog's own scroller — the click path scrolls them into
  // view — so the model can target them without a scroll dance.
  const DIALOG_SELECTOR = 'dialog[open], tp-yt-paper-dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  // A consent wall that declares no dialog role (ADR 0061) is found by a
  // rule, never a vendor list: the outermost fixed or sticky ancestor of a
  // control whose label is a consent choice, meeting the viewport. The
  // label test is the dialog policy's own pattern; the control needs only
  // size, like any dialog ref. A static strip has no such ancestor and an
  // absolute-only wall is left out rather than guessed at by z-index.
  const CONSENT_LABEL_RE = new RegExp(${JSON.stringify(CONSENT_LABEL_RE.source)}, ${JSON.stringify(CONSENT_LABEL_RE.flags)})
  const CONSENT_CONTROL_SELECTOR = 'button, a[href], input[type="submit"], input[type="button"], [role="button"], [role="link"]'
  const pinnedAncestor = (el) => {
    let outermost = null
    for (let node = el; node !== null && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const position = window.getComputedStyle(node).position
      if (position === 'fixed' || position === 'sticky') outermost = node
    }
    return outermost
  }
  const consentWallRoot = () => {
    let last = null
    for (const control of document.querySelectorAll(CONSENT_CONTROL_SELECTOR)) {
      // Cheap text first: innerText lays out, and most controls are not consent choices.
      const text = [control.getAttribute('aria-label'), control.value, control.textContent].filter((part) => typeof part === 'string').join(' ').replace(/\\s+/g, ' ')
      if (!CONSENT_LABEL_RE.test(text) || !hasSize(control) || insideInert(control)) continue
      const root = pinnedAncestor(control)
      if (root === null || !rectVisible(root)) continue
      if (last === null || (last.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) last = root
    }
    return last
  }
  const currentDialogRoot = () => {
    const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter((dialog) => {
      const style = window.getComputedStyle(dialog)
      return dialog.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && hasSize(dialog) && !insideInert(dialog)
    })
    // A role-bearing root always wins over the rule.
    return dialogs.length > 0 ? dialogs[dialogs.length - 1] : consentWallRoot()
  }
  // Challenge widgets (Turnstile, reCAPTCHA) live in cross-origin iframes
  // whose content the top frame cannot read. Listing them (ADR 0007) with
  // their absolute src makes the Blocker visible to read_page. Same-origin
  // frames are page chrome, not Blockers — they stay invisible.
  // Attribute values resolved against the page URL; null when the attribute
  // is absent or unresolvable.
  const absoluteAttr = (el, name) => {
    const raw = el.getAttribute(name)
    if (!raw) return null
    try {
      return new URL(raw, location.href)
    } catch (e) {
      return null
    }
  }
  const crossOriginIframeSrc = (el) => {
    const url = absoluteAttr(el, 'src')
    if (!url) return null
    if (url.origin === location.origin) return null
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  }
  // Snapshot hrefs (#77): resolve the raw attribute against the page so the
  // model sees — and can navigate to — where links actually go; root-relative
  // result URLs are the norm on SERPs.
  const absoluteHref = (el) => {
    const url = absoluteAttr(el, 'href')
    return url ? url.href : null
  }
  const collectElements = (dialogRoot) => {
    const dialogElements = []
    const pageElements = []
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (el.tagName === 'INPUT' && el.type === 'hidden') continue
      if (el.tagName === 'IFRAME' && crossOriginIframeSrc(el) === null) continue
      if (insideInert(el)) continue
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
  const renderedText = (el) => el.innerText || el.textContent || ''
  const textOf = (el) => renderedText(el).replace(/\\s+/g, ' ').trim()
  const heading = document.querySelector('h1, [role="heading"][aria-level="1"]')
  const textRoot = document.querySelector('main, article') || document.body
  // The page's text (ADR 0047): each block raw, in document order, for core
  // to render and cut (core/browser/pageText.ts). A table row, a pre block
  // and a definition list are blocks beside paragraphs, list items and
  // headings, and a container's own prose is a block as a run (#265); a tag
  // block is taken whole, so an element inside it is that block's text — a
  // paragraph in a table cell, a nested list.
  const textBlocks = []
  let collectedText = 0
  let textCut = false
  // Whether a block is in the viewport right now, so a scroll can report
  // what it brought in (#194). Rect-only intersection: a text block is not a
  // click target, so it does not need the style pass rectVisible does — a
  // hidden block has no rect, and running getComputedStyle over every
  // paragraph would cost every collect, not just a scroll.
  const rectInView = (rect) => {
    if (rect.width < 1 || rect.height < 1) return false
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw
  }
  const inViewport = (el) => rectInView(el.getBoundingClientRect())
  const rawBlock = (el) => {
    switch (el.tagName) {
      case 'TR':
        return { kind: 'row', cells: Array.from(el.cells).map(textOf) }
      case 'PRE':
        return { kind: 'pre', text: renderedText(el) }
      case 'DL':
        return {
          kind: 'definitions',
          items: Array.from(el.querySelectorAll('dt, dd'))
            .filter((item) => item.closest('dl') === el)
            .map((item) => ({ term: item.tagName === 'DT', text: textOf(item) }))
        }
      default:
        return { kind: 'text', text: textOf(el) }
    }
  }
  // Near enough for the collected-text bound, which only has to stop an
  // unbounded payload; core measures the rendered text exactly.
  const lengthOf = (block) => {
    if (block.kind === 'row') return block.cells.join('').length
    if (block.kind === 'definitions') return block.items.reduce((total, item) => total + item.text.length, 0)
    return block.text.trim().length
  }
  const take = (block, inView) => {
    const length = lengthOf(block)
    if (length === 0) return
    // Past the collected-text bound only blocks in view still ride the
    // payload — a scroll's New In View needs them; a read ends at the bound.
    if (collectedText > ${MAX_COLLECTED_PAGE_TEXT} && !inView) {
      textCut = true
      return
    }
    collectedText += length + 1
    if (inView) block.inView = true
    textBlocks.push(block)
  }
  if (heading) take({ kind: 'text', text: textOf(heading), heading: true }, inViewport(heading))
  // One recursive pass over the text root in document order (#265). A tag
  // block is taken whole at its element and not descended; an element that
  // never carries prose is skipped; every other element is descended, and
  // the text nodes and inline elements between its block children form
  // prose runs. A run is what a paragraph's innerText would render — the
  // words of an <em> or <a> included, whitespace collapsed — and enters as
  // a text block when it reaches MIN_PROSE_RUN, where it sits: a container
  // holding an intro sentence and two paragraphs reads all three in order.
  // A run is in view by a Range over its own nodes, never by its container.
  const TAG_BLOCK_SELECTOR = 'p, li, h2, h3, tr, pre, dl'
  const TAG_BLOCKS = new Set(TAG_BLOCK_SELECTOR.split(', ').map((tag) => tag.toUpperCase()))
  const NEVER_PROSE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'MATH', 'IFRAME', 'OBJECT'])
  const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'I', 'INS', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR'])
  const MIN_PROSE_RUN = 40
  // An inline element joins the run unless it wraps the heading or a tag
  // block — a card's <a> around an <h3> and a <p> — in which case it is
  // descended, so the heading stays a block of its own as it was before
  // runs existed and the h1 is never read again.
  const joinsRun = (el) => INLINE.has(el.tagName) && !el.contains(heading) && el.querySelector(TAG_BLOCK_SELECTOR) === null
  const runInView = (nodes) => {
    const range = document.createRange()
    range.setStartBefore(nodes[0])
    range.setEndAfter(nodes[nodes.length - 1])
    return rectInView(range.getBoundingClientRect())
  }
  // A line break renders as a space; any other inline element as its own
  // rendered text, unpadded, so H<sub>4</sub> reads H4.
  const runText = (nodes) =>
    nodes
      .map((node) => (node.nodeType === Node.TEXT_NODE ? node.data : node.tagName === 'BR' ? ' ' : renderedText(node)))
      .join('')
      .replace(/\\s+/g, ' ')
      .trim()
  const walk = (parent) => {
    let run = []
    const closeRun = () => {
      if (run.length === 0) return
      const text = runText(run)
      if (text.length >= MIN_PROSE_RUN) take({ kind: 'text', text }, runInView(run))
      run = []
    }
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        run.push(node)
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      if (joinsRun(node)) {
        run.push(node)
        continue
      }
      closeRun()
      // tagName is upper-case for HTML elements only; an <svg> or <math>
      // keeps its case.
      const tag = node.tagName.toUpperCase()
      if (node === heading || NEVER_PROSE.has(tag)) continue
      if (TAG_BLOCKS.has(tag)) take(rawBlock(node), inViewport(node))
      else walk(node)
    }
    closeRun()
  }
  if (textRoot) walk(textRoot)

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
      href: absoluteHref(el),
      downloadsFile: el.hasAttribute('download'),
      submitsForm: submitsFormOf(el, form),
      credentialField: isCredentialField(el),
      paymentField: isPaymentField(el),
      inForm: formFlags.inForm,
      formHasCredential: formFlags.formHasCredential,
      formHasPayment: formFlags.formHasPayment,
      searchField: isSearchField(el),
      formHasSearch: formFlags.formHasSearch,
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
  // The labels of the open dialog root's controls, read in place — no
  // collect, so the numbers the model holds stay put — for a blocked action
  // to ask whether a consent wall is what covers it (ADR 0061). Null when no
  // dialog root is open.
  window.__bingbongDialogLabels = () => {
    const root = currentDialogRoot()
    if (root === null) return null
    return Array.from(root.querySelectorAll(SELECTOR)).filter(hasSize).map(labelOf)
  }
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
  // ADR 0033: a ref number names the node the model was shown, not the
  // position. Two registries live on the page — the current collect below,
  // and the *shown* registry, the node behind each number the model was
  // last handed. The collect never touches the shown registry; only these
  // helpers do, and the controller calls them exactly where it returns
  // numbers to the model.
  window.__bingbongMarkShown = (count) => {
    window.__bingbongShownRefs = (window.__bingbongRefs || []).slice(0, count)
    return true
  }
  window.__bingbongOverlayShown = (indices) => {
    const refs = window.__bingbongRefs || []
    const shown = window.__bingbongShownRefs || []
    for (const index of indices) shown[index] = refs[index]
    window.__bingbongShownRefs = shown
    return true
  }
  window.__bingbongRefShown = (index) => {
    const node = (window.__bingbongShownRefs || [])[index]
    if (!node || !node.isConnected) return false
    return node === (window.__bingbongRefs || [])[index]
  }
  const dialogRoot = currentDialogRoot()
  // Where each element sat in the collect before this one, so the scroll
  // delta can tell a ref that entered the viewport from one that was
  // already there — DOM node identity, not a label that two unlabeled
  // buttons share. -1 for an element this collect is the first to see.
  const priorIndex = new Map()
  const prior = window.__bingbongRefs || []
  for (let index = 0; index < prior.length; index++) {
    if (!priorIndex.has(prior[index])) priorIndex.set(prior[index], index)
  }
  // Dialog controls come first so they survive the collection cap; the order
  // here is exactly what the controller's element registry is keyed by.
  const collected = collectElements(dialogRoot)
  window.__bingbongRefs = collected
  const elements = collected.map((el) => {
    const described = describeElement(el, dialogRoot)
    described.previousIndex = priorIndex.has(el) ? priorIndex.get(el) : -1
    return described
  })
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
    textBlocks,
    textCut,
    elements
  }
})()`

/**
 * Replace the shown registry with the first `count` numbers of the current
 * collect — what a page read, or the settled page an Action Outcome
 * carries, hands the model (ADR 0033). False when the page has moved on
 * from the collect that defined the helpers, which refuses the next ref
 * rather than aiming it at whatever now holds the number.
 */
export function markShownRefsScript(count: number): string {
  return `(() => typeof window.__bingbongMarkShown === 'function' ? window.__bingbongMarkShown(${count}) : false)()`
}

/**
 * Overlay the shown registry at these zero-based positions only: a scroll's
 * `new in view` block shows just the numbers it printed, so every other
 * number keeps the node it was shown as.
 */
export function overlayShownRefsScript(indices: number[]): string {
  return `(() => typeof window.__bingbongOverlayShown === 'function' ? window.__bingbongOverlayShown(${JSON.stringify(indices)}) : false)()`
}

/**
 * Is the node at this zero-based position still the node the model was
 * shown there? The one comparison every ref-taking path runs — a number
 * with no shown node, or one whose node died with the page, answers false.
 */
export function refIsShownScript(index: number): string {
  return `(() => typeof window.__bingbongRefShown === 'function' ? window.__bingbongRefShown(${index}) : false)()`
}

/**
 * What the click preparation found: fresh click coordinates, whether a
 * coordinate click lands on the target, and — when it does not — why, as
 * the page's hit test decided it (ADR 0062). No coordinates means the
 * target cannot be brought into the viewport at all.
 */
export interface ClickPrep {
  ok: boolean
  x?: number
  y?: number
  clickable?: boolean
  blocked?: { fact: 'covered'; cover: CoverProbe } | { fact: 'notShown' }
}

/**
 * Which registry numbers a Cover may be named by: the first `listed`, and —
 * when the outcome carries no listing of its own — only those still the
 * node the model was shown (ADR 0033), so a named ref is one the model holds.
 */
export interface CoverNaming {
  listed: number
  shownOnly: boolean
}

/**
 * Scroll the registry node at this index into view and hit-test its centre
 * with `elementsFromPoint`, which returns the whole paint-order stack (ADR
 * 0062). The target on top (or under its own descendant) is clickable; the
 * target in the stack under something else is Covered, and the entries
 * above it are the covers; the target absent from the stack is Not Shown —
 * inert, clipped, hidden or `pointer-events: none`, which no dismissal
 * reaches. A cover is the first entry above that is a nameable ref or lies
 * inside one; else the first with an accessible name, by role and name;
 * else the top entry's tag — the last two with up to three refs inside.
 */
export function clickPrepScript(index: number, naming: CoverNaming): string {
  return `(() => {
    const el = (window.__bingbongRefs || [])[${index}]
    if (!el || !el.isConnected) return { ok: false }
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const vw = window.innerWidth
    const vh = window.innerHeight
    const rect = el.getBoundingClientRect()
    const clamp = (value, low, high) => Math.min(Math.max(value, low), high)
    const visibleLeft = Math.max(rect.x, 0)
    const visibleRight = Math.min(rect.x + rect.width, vw)
    const visibleTop = Math.max(rect.y, 0)
    const visibleBottom = Math.min(rect.y + rect.height, vh)
    const x = Math.round(clamp(rect.x + rect.width / 2, visibleLeft, Math.max(visibleLeft, visibleRight - 1)))
    const y = Math.round(clamp(rect.y + rect.height / 2, visibleTop, Math.max(visibleTop, visibleBottom - 1)))
    if (x < 0 || y < 0 || x >= vw || y >= vh) return { ok: true, clickable: false }
    const stack = document.elementsFromPoint(x, y)
    const top = stack.length > 0 ? stack[0] : null
    if (top === el || (top !== null && el.contains(top))) return { ok: true, x, y, clickable: true }
    const at = stack.indexOf(el)
    // A modal <dialog> makes everything outside it inert without an inert
    // attribute, so the hit test skips a target it merely covers: that
    // target is Covered by the modal, and keeps ADR 0061's consent retry.
    const modal = document.querySelector('dialog:modal')
    const underModal = at < 0 && modal !== null && !modal.contains(el)
    if (at < 0 && !underModal) return { ok: true, x, y, clickable: false, blocked: { fact: 'notShown' } }
    const covered = (cover) => ({ ok: true, x, y, clickable: false, blocked: { fact: 'covered', cover } })
    const above = underModal ? [modal] : stack.slice(0, at).filter((entry) => !el.contains(entry) && !entry.contains(el))
    const refs = window.__bingbongRefs || []
    const shown = window.__bingbongShownRefs || []
    const nameable = (i) => i >= 0 && i < ${naming.listed} && (${!naming.shownOnly} || shown[i] === refs[i]) && !refs[i].contains(el)
    const refOf = (node) => {
      for (let n = node; n !== null; n = n.parentElement) {
        const i = refs.indexOf(n)
        if (nameable(i)) return i + 1
      }
      return 0
    }
    for (const entry of above) {
      const ref = refOf(entry)
      if (ref > 0) return covered({ ref })
    }
    const contained = (cover) => {
      const found = []
      for (let i = 0; i < refs.length && found.length < ${MAX_COVER_REFS}; i++) {
        if (nameable(i) && cover.contains(refs[i])) found.push(i + 1)
      }
      return found
    }
    const nameOf = (node) => {
      const parts = [node.getAttribute('aria-label')]
      const labelledBy = node.getAttribute('aria-labelledby')
      if (labelledBy) parts.push(labelledBy.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '))
      parts.push(node.getAttribute('alt'), node.getAttribute('title'))
      for (const part of parts) {
        const name = (part || '').replace(/\\s+/g, ' ').trim()
        if (name) return name.length <= 80 ? name : name.slice(0, 79) + '…'
      }
      return ''
    }
    const IMPLICIT_ROLES = { DIALOG: 'dialog', NAV: 'navigation', ASIDE: 'complementary', HEADER: 'banner', FOOTER: 'contentinfo', MAIN: 'main', FORM: 'form', SECTION: 'region', IMG: 'img', A: 'link', BUTTON: 'button', UL: 'list', OL: 'list', TABLE: 'table' }
    for (const entry of above) {
      const name = nameOf(entry)
      if (name) return covered({ role: entry.getAttribute('role') || IMPLICIT_ROLES[entry.tagName] || entry.tagName.toLowerCase(), name, contains: contained(entry) })
    }
    const first = above.length > 0 ? above[0] : stack[0]
    return covered({ tag: first.tagName.toLowerCase(), contains: contained(first) })
  })()`
}
