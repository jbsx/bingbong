import { MEDIA_FACTS_FN, PAGE_MEDIA_JS } from './pageMediaScript'
import { MAX_COLLECTED_PAGE_TEXT } from '../../core/browser/pageText'
import { CONSENT_LABEL_RE } from '../../core/browser/dialogPolicy'
import type { CoverProbe } from '../../core/browser/actionOutcome'
import { MAX_COLLECTED_PAGE_LINKS, MAX_COVER_REFS } from '../../core/browser/snapshot'

/**
 * A JS function source `(iframe) => {x, y}`: an iframe's content-box
 * origin in its document's viewport (#377) — its border box moved in by
 * its border and padding, where its frame's own coordinates start.
 */
const FRAME_BOX_FN = `((iframe) => {
  const rect = iframe.getBoundingClientRect()
  const style = window.getComputedStyle(iframe)
  return { x: rect.left + iframe.clientLeft + (parseFloat(style.paddingLeft) || 0), y: rect.top + iframe.clientTop + (parseFloat(style.paddingTop) || 0) }
})`

/** A JS function source `(iframe) => slot`: the iframe's slot in `window.frames` (#377), -1 when its window is gone. */
const FRAME_SLOT_FN = `((iframe) => {
  for (let i = 0; i < window.frames.length; i++) if (window.frames[i] === iframe.contentWindow) return i
  return -1
})`

/** A JS function source `() => slot`: this document's own slot in its parent's `window.frames` (#377), -1 for the top. */
const OWN_SLOT_FN = `(() => {
  if (window === window.top) return -1
  for (let i = 0; i < window.parent.frames.length; i++) if (window.parent.frames[i] === window) return i
  return -1
})`

/** This frame's slot in its parent's `window.frames` now (#377): what its iframe is found by at click time. */
export const OWN_SLOT_SCRIPT = `${OWN_SLOT_FN}()`

/**
 * A JS function source `(el) => tag`: an element's tagName read through
 * `Element.prototype`'s getter (#385). A form's control named `tagName`
 * overrides the form's own property; the prototype's getter it cannot.
 */
export const TAG_OF_FN = `((get) => (el) => get.call(el))(Object.getOwnPropertyDescriptor(Element.prototype, 'tagName').get)`

/** What a page never renders (#391): a script's source, a stylesheet, a noscript fallback, a template. */
const NEVER_RENDERED_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']

/**
 * A JS function source `(el, separator) => text`: an element's text nodes
 * joined, without what a page never renders. textContent keeps it all, and
 * so does innerText for an element that is not rendered.
 */
const SOURCE_FREE_TEXT_FN = `((tagOf) => {
  const NEVER_RENDERED = new Set(${JSON.stringify(NEVER_RENDERED_TAGS)})
  const accept = (node) => (node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NEVER_RENDERED.has(tagOf(node).toUpperCase()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
  return (el, separator = '') => {
    const parts = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: accept })
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue)
    return parts.join(separator)
  }
})(${TAG_OF_FN})`

// Runs inside the pane's page via Runtime.evaluate. Returns the CollectedPage
// shape consumed by core/browser/snapshot.ts — DOM-specific work (labeling,
// rects, visibility) happens here; numbering/kinds/formatting happen in core.
export const COLLECT_PAGE_SCRIPT = `(() => {
  const tagOf = ${TAG_OF_FN}
  const sourceFreeText = ${SOURCE_FREE_TEXT_FN}
  // An element's text as it shows (#391). One that holds no source reads as
  // innerText; one that does keeps innerText only while it is rendered,
  // which leaves the source out, and is otherwise read without it.
  const NEVER_RENDERED_SELECTOR = ${JSON.stringify(NEVER_RENDERED_TAGS.join(', ').toLowerCase())}
  const renderedText = (el) => {
    if (el.querySelector(NEVER_RENDERED_SELECTOR) === null) return el.innerText || el.textContent || ''
    return (el.getClientRects().length > 0 && el.innerText) || sourceFreeText(el)
  }
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
    // Every spelling Vimium takes as editable (#381): an empty value and its own name too.
    '[contenteditable="true" i]',
    '[contenteditable=""]',
    '[contenteditable="contenteditable" i]',
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
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="treeitem"]',
    '[role="option"]',
    // A details is acted on through its summary (#386, ADR 0083): the summary is the control the platform makes.
    'details > summary:first-of-type',
    'iframe'
  ].join(',')
  // Read in a frame (#377, ADR 0081): this document is one of the page's
  // frames, paired with its iframe by its own slot in its parent's
  // window.frames; its text the page merge puts at its iframe's place (#378).
  const inFrame = window !== window.top
  const frameSlotOf = ${FRAME_SLOT_FN}
  const ownSlot = ${OWN_SLOT_FN}()
  // Vimium-style visibility: rect intersection only. Overlays do NOT hide an
  // element from detection — a covered "background" button is still a real
  // target. The click prep then decides (ADR 0062): a real click where any
  // part of it shows, a direct activation under a cover that paints nothing,
  // and a Covered verdict naming the cover otherwise.
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
        if (source) parts.push(sourceFreeText(source))
      }
    }
    if (el.labels) {
      for (const label of Array.from(el.labels)) parts.push(sourceFreeText(label))
    }
    if (el.placeholder) parts.push(el.placeholder)
    if ((tagOf(el) === 'INPUT' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) || tagOf(el) === 'BUTTON') {
      if (typeof el.value === 'string' && el.value) parts.push(el.value)
    }
    parts.push(renderedText(el))
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
  const isValuelessInput = (el) => tagOf(el) === 'INPUT' && VALUELESS_INPUT_TYPES.includes((el.type || 'text').toLowerCase())
  // Search-flavored fields (ADR 0015): type="search", or the identifying
  // attributes matching /search|query|^q$/i — each attribute tested whole, so
  // Google's name=q matches while "qq" or a submit button named "search" do
  // not leak in (button/hidden types are excluded below regardless). The
  // attribute clause also reaches SPA search boxes that are not form controls:
  // contenteditable and role=searchbox/textbox hosts qualify through their
  // id/aria-label, so a click on their form's submit is exempt alike.
  const SEARCH_HINT_RE = /search|query|^q$/i
  const isEditableField = (el) => {
    if (tagOf(el) === 'INPUT' || tagOf(el) === 'TEXTAREA') return true
    if (el.isContentEditable) return true
    const role = el.getAttribute('role')
    return role === 'searchbox' || role === 'textbox'
  }
  const isSearchField = (el) => {
    if (!isEditableField(el)) return false
    if (isValuelessInput(el)) return false
    if (tagOf(el) === 'INPUT' && el.type === 'search') return true
    const hints = [el.name, el.id, el.getAttribute('aria-label'), el.placeholder]
    return hints.some((hint) => typeof hint === 'string' && hint !== '' && SEARCH_HINT_RE.test(hint))
  }
  const isCredentialField = (el) => {
    if (tagOf(el) === 'INPUT' && el.type === 'password') return true
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
    if (tagOf(el) === 'INPUT') return el.type === 'submit' || el.type === 'image'
    if (tagOf(el) === 'BUTTON') return !el.type || el.type === 'submit'
    return false
  }
  const formFlagsOf = (form) => {
    if (!form) return { inForm: false, formHasCredential: false, formHasPayment: false, formHasSearch: false }
    let credential = false
    let payment = false
    let search = false
    for (const field of form.querySelectorAll('input,select,textarea,[contenteditable="true" i],[contenteditable=""],[contenteditable="contenteditable" i],[role="searchbox"],[role="textbox"]')) {
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
      // Text without layout first: innerText lays out, and most controls are not consent choices.
      const text = [control.getAttribute('aria-label'), control.value, sourceFreeText(control)].filter((part) => typeof part === 'string').join(' ').replace(/\\s+/g, ' ')
      if (!CONSENT_LABEL_RE.test(text) || !hasSize(control) || insideInert(control)) continue
      const root = pinnedAncestor(control)
      if (root === null || !rectVisible(root)) continue
      if (last === null || (last.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) last = root
    }
    return last
  }
  // A pop-up that declares no dialog role and offers no consent choice
  // (X's logged-out sign-in sheet: three plain divs) is found by what it
  // does, not what it says: a fixed layer that is on top at most of the
  // viewport's sample points, spans at least half the viewport, and holds
  // few of the page's controls. A layout shell that is fixed over the whole
  // page holds the page's own controls, so it is the page, not a cover.
  const COVER_SAMPLE_POINTS = [
    [vw / 2, vh / 2],
    [vw / 4, vh / 4],
    [(vw * 3) / 4, vh / 4],
    [vw / 4, (vh * 3) / 4],
    [(vw * 3) / 4, (vh * 3) / 4]
  ]
  const coverRoot = () => {
    const onTop = new Map()
    for (const [x, y] of COVER_SAMPLE_POINTS) {
      let layer = null
      for (let node = document.elementFromPoint(x, y); node !== null && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        if (window.getComputedStyle(node).position === 'fixed') layer = node
      }
      if (layer !== null) onTop.set(layer, (onTop.get(layer) || 0) + 1)
    }
    let cover = null
    let controls = null
    for (const [layer, points] of onTop) {
      if (points < 3 || insideInert(layer)) continue
      const rect = layer.getBoundingClientRect()
      if (rect.width * rect.height < (vw * vh) / 2) continue
      if (controls === null) controls = Array.from(document.querySelectorAll(SELECTOR)).filter((el) => hasSize(el) && !insideInert(el))
      const held = controls.filter((el) => layer.contains(el)).length
      if (held * 2 > controls.length) continue
      if (cover === null || points > onTop.get(cover)) cover = layer
    }
    return cover
  }
  const currentDialogRoot = () => {
    const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter((dialog) => {
      const style = window.getComputedStyle(dialog)
      return dialog.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && hasSize(dialog) && !insideInert(dialog)
    })
    // A role-bearing root always wins over the rules; the consent rule over the cover rule.
    if (dialogs.length > 0) return dialogs[dialogs.length - 1]
    const consent = consentWallRoot()
    return consent !== null ? consent : coverRoot()
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
  // Unmarked Controls (#381, ADR 0083): Vimium's link-hint cues, one for one
  // from its getLocalHintsForElement, for a control no tag or role marks.
  // A strong cue makes a ref. A weak one — a button/btn class, and any span —
  // does only when no ref among the 6 after it in document order sits within
  // 3 levels under it. tabindex alone gives nothing, the cursor and click
  // listeners are never read, and aria-disabled vetoes.
  const NG_CLICK = []
  for (const prefix of ['', 'data-', 'x-']) for (const separator of ['-', ':', '_']) NG_CLICK.push(prefix + 'ng' + separator + 'click')
  const angular = document.getElementsByClassName('ng-scope').length > 0
  const CUE_SELECTOR = ['a', '[onclick]', '[jsaction]', 'details', 'object', 'embed', 'label', 'img[style*="zoom" i]', '[class*="button" i]', '[class*="btn" i]', '[tabindex]']
    .concat(angular ? NG_CLICK.map((name) => '[' + CSS.escape(name) + ']') : [])
    .join(',')
  const CANDIDATE_SELECTOR = SELECTOR + ',' + CUE_SELECTOR
  // A jsaction rule binds a click when its event is click (or left out), its
  // namespace is not none and it names an action — Vimium's parse, as it is.
  const jsactionClicks = (el) => el.getAttribute('jsaction').split(';').some((rule) => {
    const split = rule.trim().split(':')
    if (split.length < 1 || split.length > 2) return false
    const [eventType, namespace, actionName] = split.length === 1
      ? ['click', ...split[0].trim().split('.'), '_']
      : [split[0], ...split[1].trim().split('.'), '_']
    return eventType === 'click' && namespace !== 'none' && actionName !== '_'
  })
  // An unmarked element's cue: strong; weak; a label, strong while its
  // control is no ref; tabindex only, which stands in the weak cues'
  // lookback, as in Vimium, but is never a ref; or none.
  const cueOf = (el) => {
    // Vimium's test is truthy: an empty aria-disabled vetoes nothing.
    const ariaDisabled = el.getAttribute('aria-disabled')
    if (ariaDisabled && ariaDisabled.toLowerCase() === 'true') return null
    const tag = tagOf(el).toLowerCase()
    const strong = (angular && NG_CLICK.some((name) => el.hasAttribute(name))) ||
      el.hasAttribute('onclick') ||
      (el.hasAttribute('jsaction') && jsactionClicks(el)) ||
      tag === 'a' || tag === 'object' || tag === 'embed' ||
      // A details with a summary gives none of its own (#386): its summary is the ref.
      (tag === 'details' && el.querySelector(':scope > summary') === null) ||
      (tag === 'img' && ['zoom-in', 'zoom-out'].includes(el.style.cursor))
    if (strong) return tag === 'span' ? 'weak' : 'strong'
    if (tag === 'label' && el.control && !el.control.disabled) return 'label'
    return fallbackCueOf(el)
  }
  // What an element that is not clickable yet falls back to: a button/btn
  // class (weak — a span's too), else a tabindex of 0 or more.
  const fallbackCueOf = (el) => {
    const className = (el.getAttribute('class') || '').toLowerCase()
    if (className.includes('button') || className.includes('btn')) return 'weak'
    const tabIndex = parseInt(el.getAttribute('tabindex'), 10)
    return tabIndex >= 0 ? 'tabindex' : null
  }
  // The refs a click acts on whole (#380's click roles among them): a weak
  // cue inside one is that ref's own icon or text. Every <a>, address or
  // not: YouTube's top-bar icon buttons are addressless anchors. A details'
  // summary too (#386).
  const WHOLE_CLICK_SELECTOR = 'a, area[href], details > summary:first-of-type, button, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="treeitem"], [role="option"]'
  // ADR 0062's inert rule and the dialog layer, across open shadow roots:
  // an element inside a shadow tree is inside its host's ancestors too.
  const hostOf = (node) => {
    const root = node.getRootNode()
    return root instanceof ShadowRoot ? root.host : null
  }
  const insideInertDeep = (el) => {
    for (let node = el; node !== null; node = hostOf(node)) if (insideInert(node)) return true
    return false
  }
  const containsDeep = (root, el) => {
    for (let node = el; node !== null; node = hostOf(node)) if (root.contains(node)) return true
    return false
  }
  // Every candidate in document order, each open shadow root's right after
  // its host, as Vimium walks them: refs of every kind live in shadow roots.
  const candidatesIn = (root, out) => {
    const hosts = []
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) hosts.push(el)
    let next = 0
    for (const el of root.querySelectorAll(CANDIDATE_SELECTOR)) {
      while (next < hosts.length && hosts[next] !== el && (hosts[next].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) candidatesIn(hosts[next++].shadowRoot, out)
      out.push(el)
      if (next < hosts.length && hosts[next] === el) candidatesIn(hosts[next++].shadowRoot, out)
    }
    while (next < hosts.length) candidatesIn(hosts[next++].shadowRoot, out)
    return out
  }
  // Scroll Regions (#383, ADR 0085): Vimium's scroll cue without its ±1 px
  // probe — a div, ol or ul whose content overflows a view whose overflow-y
  // scrolls — that passes ADR 0062's rect rule, with at least half its box
  // in the viewport and at least half a view of content hidden. Vertical
  // only; never the body, whose scroll is the page's own.
  const REGION_TAGS = new Set(['DIV', 'OL', 'UL'])
  const isScrollRegion = (el) => {
    const view = el.clientHeight
    if (view < 1 || el.scrollHeight - view < view / 2) return false
    const overflowY = window.getComputedStyle(el).overflowY
    if ((overflowY !== 'auto' && overflowY !== 'scroll') || !rectVisible(el) || insideInertDeep(el)) return false
    const rect = el.getBoundingClientRect()
    const shown = (Math.min(rect.bottom, vh) - Math.max(rect.top, 0)) * (Math.min(rect.right, vw) - Math.max(rect.left, 0))
    return shown * 2 >= rect.width * rect.height
  }
  // Every Scroll Region of a tree and the open shadow roots under it, in one walk.
  const regionsIn = (root, out) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) regionsIn(el.shadowRoot, out)
      if (REGION_TAGS.has(tagOf(el)) && isScrollRegion(el)) out.push(el)
    }
    return out
  }
  // Document order across open shadow roots, as candidatesIn walks it: a
  // host before its shadow tree, its shadow tree before its light children.
  const treeChain = (el) => {
    const chain = [el]
    for (let host = hostOf(el); host !== null; host = hostOf(host)) chain.unshift(host)
    return chain
  }
  const precedes = (a, b) => {
    const [first, second] = [treeChain(a), treeChain(b)]
    for (let level = 0; level < Math.min(first.length, second.length); level++) {
      if (first[level] !== second[level]) return (first[level].compareDocumentPosition(second[level]) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    }
    return first.length < second.length
  }
  // A region's label (ADR 0085): its accessible name, else the first
  // heading inside it, else the first 60 characters of its text — never
  // the whole region's text; none makes a Textless Ref (ADR 0084).
  const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]'
  const regionLabelOf = (el) => {
    const parts = [el.getAttribute('aria-label')]
    const labelledBy = el.getAttribute('aria-labelledby')
    // Its own tree's ids: a region in a shadow root is labelled from inside it.
    const tree = typeof el.getRootNode().getElementById === 'function' ? el.getRootNode() : document
    if (labelledBy) for (const source of labelledBy.split(/\\s+/).map((id) => tree.getElementById(id))) if (source) parts.push(sourceFreeText(source))
    parts.push(el.getAttribute('title'))
    const named = parts.filter((part) => typeof part === 'string').join(' ').replace(/\\s+/g, ' ').trim()
    if (named) return named.slice(0, 300)
    const heading = el.querySelector(HEADING_SELECTOR)
    const headingText = heading ? textOf(heading) : ''
    return headingText ? headingText.slice(0, 300) : textOf(el).slice(0, 60).trim()
  }
  // The collect's Unmarked Controls: kinded as buttons, with no flag of their own.
  let unmarked = new WeakSet()
  // The collect's Scroll Regions: labelled and described as regions.
  let regions = new WeakSet()
  const labelFor = (el) => (regions.has(el) ? regionLabelOf(el) : labelOf(el))
  const MAX_COLLECTED = 400
  const collectElements = (dialogRoot) => {
    const shown = []
    for (const el of candidatesIn(document, [])) {
      if (tagOf(el) === 'INPUT' && el.type === 'hidden') continue
      const marked = el.matches(SELECTOR)
      const cue = marked ? null : cueOf(el)
      if (!marked && cue === null) continue
      if (insideInertDeep(el)) continue
      const dialog = dialogRoot !== null && containsDeep(dialogRoot, el)
      if (dialog ? !hasSize(el) : !rectVisible(el)) continue
      shown.push({ el, marked, cue, dialog })
    }
    // A label is strong while its control gives no hint; else it falls back as any element does.
    const hinted = new Set(shown.filter((entry) => entry.cue !== 'label').map((entry) => entry.el))
    const hints = shown
      .map((entry) => (entry.cue !== 'label' ? entry : { ...entry, cue: hinted.has(entry.el.control) ? fallbackCueOf(entry.el) : 'strong' }))
      .filter((entry) => entry.marked || entry.cue !== null)
    const kept = hints.filter((entry, position) => {
      if (entry.cue === 'tabindex') return false
      if (entry.cue !== 'weak') return true
      // Not Vimium's (ADR 0083, #384): a weak cue inside a ref a click acts
      // on whole is that ref's own icon or text. Measured 2026-10-22 on
      // clean pages, first viewport: a YouTube watch page 48 refs with this
      // line, 65 without — the 17 dropped, 14 textless icons and 3 spans
      // within the parent's label, none a distinct control; BBC News 45 and
      // the Guardian 48 either way.
      if (entry.el.parentElement !== null && entry.el.parentElement.closest(WHOLE_CLICK_SELECTOR) !== null) return false
      for (let index = position + 1; index < hints.length && index <= position + 6; index++) {
        let node = hints[index].el
        for (let level = 0; level < 3; level++) {
          node = node && node.parentElement
          if (node === entry.el) return false
        }
      }
      return true
    })
    // Each Scroll Region at its place in document order, unless it is a ref already.
    const refsKept = new Set(kept.map((entry) => entry.el))
    const all = kept.slice()
    for (const el of regionsIn(document, [])) {
      if (refsKept.has(el)) continue
      const at = all.findIndex((entry) => precedes(el, entry.el))
      all.splice(at < 0 ? all.length : at, 0, { el, marked: false, cue: 'region', dialog: dialogRoot !== null && containsDeep(dialogRoot, el) })
    }
    // Dialog controls first, so they survive the cap; marked elements take
    // the 400 places first, Unmarked Controls the room left, and Scroll
    // Regions what room is left after them, each where it sits in document
    // order.
    const ordered = all.filter((entry) => entry.dialog).concat(all.filter((entry) => !entry.dialog))
    let room = MAX_COLLECTED - ordered.filter((entry) => entry.marked).length
    const allowed = new Set()
    for (const cue of ['unmarked', 'region']) {
      for (const entry of ordered) {
        if (room > 0 && !entry.marked && (entry.cue === 'region') === (cue === 'region')) {
          allowed.add(entry)
          room--
        }
      }
    }
    const taken = ordered.filter((entry) => entry.marked || allowed.has(entry)).slice(0, MAX_COLLECTED)
    unmarked = new WeakSet(taken.filter((entry) => !entry.marked && entry.cue !== 'region').map((entry) => entry.el))
    regions = new WeakSet(taken.filter((entry) => entry.cue === 'region').map((entry) => entry.el))
    return taken.map((entry) => entry.el)
  }
  const textOf = (el) => renderedText(el).replace(/\\s+/g, ' ').trim()
  const heading = document.querySelector('h1, [role="heading"][aria-level="1"]')
  // The page's text is its main landmark's, and the body's when it has
  // none — or one that holds no text at all: a site's template around an
  // empty <main> puts its one sentence outside it ("The search service is
  // currently unavailable"), and that sentence is the page, not nothing.
  const landmark = document.querySelector('main, article')
  const textRoot = landmark && /\\S/.test(sourceFreeText(landmark)) ? landmark : document.body
  // The page's text (ADR 0047): each block raw, in document order, for core
  // to render and cut (core/browser/pageText.ts). A table row, a pre block
  // and a definition list are blocks beside paragraphs, list items and
  // headings, and a container's own prose is a block as a run (#265); a tag
  // block is taken whole, so an element inside it is that block's text — a
  // paragraph in a table cell, a nested list.
  const textBlocks = []
  // The text registry (#393, ADR 0086): each block's element, or a prose
  // run's Range, at the index its block's node names — where a Show Op
  // finds it. Replaced by every collect, as the ref registry is.
  const textNodes = []
  window.__bingbongText = textNodes
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
  // Rendered and wholly below the viewport (#393): a hidden block has no box and is never below.
  const rectBelow = (rect) => rect.width >= 1 && rect.height >= 1 && rect.top >= vh
  const rawBlock = (el) => {
    switch (tagOf(el)) {
      case 'TR':
        return { kind: 'row', cells: Array.from(el.cells).map(textOf) }
      case 'PRE':
        return { kind: 'pre', text: renderedText(el) }
      case 'DL':
        return {
          kind: 'definitions',
          items: Array.from(el.querySelectorAll('dt, dd'))
            .filter((item) => item.closest('dl') === el)
            .map((item) => ({ term: tagOf(item) === 'DT', text: textOf(item) }))
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
  // The box is the block's element, or a prose run's Range: where it is, and what a Show Op scrolls to.
  const take = (block, box) => {
    const length = lengthOf(block)
    if (length === 0) return
    const rect = box.getBoundingClientRect()
    const inView = rectInView(rect)
    // Past the collected-text bound only blocks in view still ride the
    // payload — a scroll's New In View needs them; a read ends at the bound.
    if (collectedText > ${MAX_COLLECTED_PAGE_TEXT} && !inView) {
      textCut = true
      return
    }
    collectedText += length + 1
    if (inView) block.inView = true
    else if (rectBelow(rect)) block.below = true
    block.node = textNodes.length
    textNodes.push(box)
    textBlocks.push(block)
  }
  // A frame's h1 is its first block at its iframe's place, not the page's.
  if (heading) take({ kind: 'text', text: textOf(heading), ...(inFrame ? {} : { heading: true }) }, heading)
  // An iframe's place in the text (#378, ADR 0081): the page merge puts its
  // frame's own text here. The iframe itself carries no prose; one inside a
  // tag block takes the place just after it. Past the collected-text bound
  // the read has ended, and a frame's place with it.
  const markFrame = (iframe) => {
    if (collectedText > ${MAX_COLLECTED_PAGE_TEXT}) textCut = true
    else textBlocks.push({ kind: 'frame', slot: frameSlotOf(iframe) })
  }
  // One recursive pass over the text root in document order (#265). A tag
  // block is taken whole at its element and not descended; an element that
  // never carries prose is skipped; every other element is descended, and
  // the text nodes and inline elements between its block children form
  // prose runs. A run is what a paragraph's innerText would render — the
  // words of an <em> or <a> included, whitespace collapsed — and enters as
  // a text block when it reaches MIN_PROSE_RUN, where it sits: a container
  // holding an intro sentence and two paragraphs reads all three in order.
  // A run is placed by a Range over its own nodes, never by its container.
  const TAG_BLOCK_SELECTOR = 'p, li, h2, h3, tr, pre, dl'
  const TAG_BLOCKS = new Set(TAG_BLOCK_SELECTOR.split(', ').map((tag) => tag.toUpperCase()))
  const NEVER_PROSE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'MATH', 'IFRAME', 'OBJECT'])
  const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'I', 'INS', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR'])
  const MIN_PROSE_RUN = 40
  // An inline element joins the run unless it wraps the heading or a tag
  // block — a card's <a> around an <h3> and a <p> — in which case it is
  // descended, so the heading stays a block of its own as it was before
  // runs existed and the h1 is never read again. One around an iframe — an
  // embed's <span> — is descended too, so the frame keeps its place (#378).
  const joinsRun = (el) => INLINE.has(tagOf(el)) && !el.contains(heading) && el.querySelector(TAG_BLOCK_SELECTOR + ', iframe') === null
  const runRange = (nodes) => {
    const range = document.createRange()
    range.setStartBefore(nodes[0])
    range.setEndAfter(nodes[nodes.length - 1])
    return range
  }
  // A line break renders as a space; any other inline element as its own
  // rendered text, unpadded, so H<sub>4</sub> reads H4.
  const runText = (nodes) =>
    nodes
      .map((node) => (node.nodeType === Node.TEXT_NODE ? node.data : tagOf(node) === 'BR' ? ' ' : renderedText(node)))
      .join('')
      .replace(/\\s+/g, ' ')
      .trim()
  const walk = (parent) => {
    let run = []
    const closeRun = () => {
      if (run.length === 0) return
      const text = runText(run)
      if (text.length >= MIN_PROSE_RUN) take({ kind: 'text', text }, runRange(run))
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
      const tag = tagOf(node).toUpperCase()
      if (tag === 'IFRAME') markFrame(node)
      if (node === heading || NEVER_PROSE.has(tag)) continue
      if (TAG_BLOCKS.has(tag)) {
        take(rawBlock(node), node)
        node.querySelectorAll('iframe').forEach(markFrame)
      } else walk(node)
    }
    closeRun()
  }
  if (textRoot) walk(textRoot)

  // What a closed trigger opens (#388): the names of the controls in the
  // panel it shows, read while that panel is hidden, by kind and never by
  // site. The panel is the element its aria-controls names (YouTube's
  // player Settings, empty until first opened); a trigger without one has
  // the hidden panel beside it in its nearest container (Wikipedia's
  // dropdowns: a checkbox and a sibling panel). An open panel's controls
  // are refs of their own, so it names none.
  const HELD_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], a[href], button, [role="button"], [role="link"]'
  const MAX_HELD = 16
  const opensSomething = (el) => {
    const popup = el.getAttribute('aria-haspopup')
    return (popup !== null && popup !== 'false') || el.getAttribute('aria-expanded') === 'false'
  }
  const isHidden = (el) => (typeof el.checkVisibility === 'function' ? !el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : el.getClientRects().length === 0)
  const panelOf = (el) => {
    const controls = (el.getAttribute('aria-controls') || '').split(/\\s+/).filter((id) => id !== '')
    const tree = typeof el.getRootNode().getElementById === 'function' ? el.getRootNode() : document
    const controlled = controls.map((id) => tree.getElementById(id)).find((panel) => panel)
    if (controlled) return controlled
    // An aria-controls that names nothing on the page is no answer: the structure still is. The nearest container: the first ancestor that holds more than the trigger's own wrappers.
    let child = el
    let parent = el.parentElement
    while (parent !== null && parent !== document.body && parent.children.length === 1) [child, parent] = [parent, parent.parentElement]
    if (parent === null || parent === document.body) return null
    return Array.from(parent.children).find((sibling) => sibling !== child && isHidden(sibling) && sibling.querySelector(HELD_SELECTOR) !== null) || null
  }
  // A hidden element has no rendered text, so its words are its text nodes, spaced: "Sleep timer" "Off" is not "Sleep timerOff".
  const spacedText = (el) => sourceFreeText(el, ' ').replace(/\\s+/g, ' ').trim()
  const hiddenInside = (el, panel) => {
    // display alone: visibility inherits, so a panel hidden by it would hide every row.
    for (let node = el; node !== null && node !== panel; node = node.parentElement) if (window.getComputedStyle(node).display === 'none') return true
    return false
  }
  const heldBy = (el) => {
    if (!opensSomething(el)) return []
    const panel = panelOf(el)
    if (panel === null || panel.contains(el) || !isHidden(panel)) return []
    const held = []
    for (const item of panel.querySelectorAll(HELD_SELECTOR)) {
      // A control inside another is the outer one's words, once.
      const outer = item.parentElement.closest(HELD_SELECTOR)
      if (outer !== null && panel.contains(outer)) continue
      // A row the panel hides on its own would not show when it opens either.
      if (hiddenInside(item, panel)) continue
      const name = (item.getAttribute('aria-label') || '').trim() || spacedText(item) || (item.title || '').trim()
      if (name !== '' && !held.includes(name)) held.push(name)
      if (held.length === MAX_HELD) break
    }
    return held
  }
  const mediaFactsOf = ${MEDIA_FACTS_FN}
  const describeElement = (el, dialogRoot) => {
    const held = heldBy(el)
    const rect = el.getBoundingClientRect()
    const form = formOf(el)
    const formFlags = formFlagsOf(form)
    const tag = tagOf(el)
    return {
      tag: tag.toLowerCase(),
      role: unmarked.has(el) ? 'button' : el.getAttribute('role') || (el.hasAttribute('onclick') ? 'button' : null),
      inputType: tag === 'INPUT' ? el.type : null,
      label: labelFor(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      src: tag === 'IFRAME' ? crossOriginIframeSrc(el) : null,
      // An iframe's slot and content-box origin (#377): its frame's refs take its place, offset by it.
      ...(tag === 'IFRAME' ? { frameIndex: frameSlotOf(el), frameBox: ${FRAME_BOX_FN}(el) } : {}),
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
      layer: dialogRoot !== null && containsDeep(dialogRoot, el) ? 'dialog' : 'page',
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      selectedOption: tag === 'SELECT' && el.selectedOptions.length > 0
        ? textOf(el.selectedOptions[0]).slice(0, 160)
        : null,
      value: typeof el.value === 'string' && !(tag === 'INPUT' && el.type === 'password')
        ? el.value.slice(0, 160)
        : (el.isContentEditable ? textOf(el).slice(0, 160) : null),
      ariaPressed: el.getAttribute('aria-pressed'),
      className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
      // A media element's own facts (#372): what its ref line carries and its Media Ops are gated by.
      ...(tag === 'VIDEO' || tag === 'AUDIO' ? { media: mediaFactsOf(el) } : {}),
      // What a closed trigger opens (#388): its line's "menu holds".
      ...(held.length > 0 ? { holds: held } : {}),
      // A Scroll Region's own facts (#383): what its line's position and length, and its Scroll Ops, are read off.
      ...(regions.has(el) ? { region: { top: el.scrollTop, height: el.scrollHeight, view: el.clientHeight } } : {})
    }
  }
  window.__bingbongDescribeElement = (el) => describeElement(el, currentDialogRoot())
  // Whether a dialog root is open now, read in place — no collect — for a
  // consent dismissal to wait until its sheet has left the page.
  window.__bingbongDialogOpen = () => currentDialogRoot() !== null
  // The labels of the open dialog root's controls, read in place — no
  // collect, so the numbers the model holds stay put — for a blocked action
  // to ask whether a consent wall is what covers it (ADR 0061). Null when no
  // dialog root is open.
  window.__bingbongDialogLabels = () => {
    const root = currentDialogRoot()
    if (root === null) return null
    return Array.from(root.querySelectorAll(SELECTOR)).filter(hasSize).map(labelOf)
  }
  // The links of the whole page (#303, note on ADR 0070), read in place — no
  // collect, so the numbers the model holds stay put. Every link that has
  // size and is not hidden, inert or inside a dialog — the open dialog root
  // or any other — in document order, wherever the viewport is: a listing's
  // results often begin below the fold, and the refs are the links in view.
  // The style pass is rectVisible's, without its viewport bound. The
  // address rides beside the links, so the caller can tell the page they
  // were read from is the page it printed.
  window.__bingbongPageLinks = () => {
    const root = currentDialogRoot()
    const links = []
    for (const el of document.querySelectorAll('a[href], area[href], [role="link"]')) {
      if (links.length >= ${MAX_COLLECTED_PAGE_LINKS}) break
      if (insideInert(el) || (root !== null && root.contains(el)) || el.closest(DIALOG_SELECTOR) !== null || !hasSize(el)) continue
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const href = absoluteHref(el)
      if (href === null) continue
      links.push({ label: labelOf(el), href })
    }
    return { url: location.href, links }
  }
  // The page's media element (#363, ADR 0079): the one playing, else the
  // first that has started — its title, where it is, and the flags a
  // right-click menu toggles that no ref shows. Null when none has started.
  // A live stream's Infinity duration travels as null.
  const mediaOf = () => {
    const el = ${PAGE_MEDIA_JS}
    if (!el) return null
    const title = (el.getAttribute('title') || el.getAttribute('aria-label') || document.title || '').trim()
    return {
      title,
      paused: el.paused,
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : null,
      loop: el.loop,
      muted: el.muted
    }
  }
  window.__bingbongPageProbe = (targetIndex, targetLabel) => {
    const dialogRoot = currentDialogRoot()
    const refs = collectElements(dialogRoot).slice(0, 75)
    const truncateLabel = (label) => label.length <= 80 ? label : label.slice(0, 79) + '…'
    const labels = refs.map((ref) => truncateLabel(labelFor(ref)))
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
        dialogOpen: dialogRoot !== null,
        media: (() => {
          const media = mediaOf()
          return media === null ? null : { paused: media.paused, loop: media.loop, muted: media.muted }
        })(),
        fullScreen: document.fullscreenElement !== null
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
  // The same, for the registry indices a whole numbering holds of this
  // document when they are not its first (#377): frames' refs sit between.
  window.__bingbongMarkShownAt = (indices) => {
    const refs = window.__bingbongRefs || []
    const shown = []
    for (const index of indices) shown[index] = refs[index]
    window.__bingbongShownRefs = shown
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
  // Player Switches (#389, ADR 0080): a two-state control — a button
  // pressed or not, a switch, a checkbox by role or input; never one choice
  // among several — sits with a media element when the smallest part of the
  // page holding both holds no other video or audio. By kind, never by its
  // words: Jev reads its label on the media ref's line.
  const isSwitch = (el) => {
    const role = el.getAttribute('role')
    if (role === 'switch' || role === 'checkbox') return true
    if (tagOf(el).toUpperCase() === 'INPUT' && el.type === 'checkbox' && role === null) return true
    return el.hasAttribute('aria-pressed') && (role === null || role === 'button')
  }
  // Read off the element itself, as the collect reads every fact: the Ref State comes after it, for refs alone.
  const switchOn = (el) => {
    if (tagOf(el).toUpperCase() === 'INPUT' && el.type === 'checkbox') return el.checked
    const role = el.getAttribute('role')
    return role === 'switch' || role === 'checkbox' ? el.getAttribute('aria-checked') === 'true' : el.getAttribute('aria-pressed') === 'true'
  }
  const isMedia = (el) => { const tag = tagOf(el).toUpperCase(); return tag === 'VIDEO' || tag === 'AUDIO' }
  const mediaIn = (root, out) => {
    for (const el of root.querySelectorAll('*')) {
      if (isMedia(el)) out.push(el)
      if (el.shadowRoot) mediaIn(el.shadowRoot, out)
    }
    return out
  }
  // An element's parent, its shadow root's host at the top of a shadow tree.
  const parentDeep = (node) => node.parentElement || hostOf(node)
  const switchesByMedia = new Map()
  if (collected.some(isMedia) && collected.some(isSwitch)) {
    const media = mediaIn(document, [])
    collected.forEach((el, index) => {
      if (!isSwitch(el)) return
      for (let node = parentDeep(el); node !== null; node = parentDeep(node)) {
        const held = media.filter((candidate) => containsDeep(node, candidate))
        if (held.length === 0) continue
        if (held.length === 1) switchesByMedia.set(held[0], [...(switchesByMedia.get(held[0]) || []), { index, on: switchOn(el) }])
        break
      }
    })
  }
  const elements = collected.map((el) => {
    const described = describeElement(el, dialogRoot)
    described.previousIndex = priorIndex.has(el) ? priorIndex.get(el) : -1
    if (switchesByMedia.has(el)) described.switches = switchesByMedia.get(el)
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
    elements,
    // The page's playing media is the top document's (#363); a frame's is on its media refs.
    media: inFrame ? null : mediaOf(),
    // Full screen is the document's (#387), read by kind: a frame's element in full screen is its iframe in the top's.
    ...(inFrame ? {} : { fullScreen: document.fullscreenElement !== null }),
    frameIndex: ownSlot,
    origin: window.origin
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
 * Replace the shown registry with just these zero-based registry indices
 * (#377): a document's share of a numbering that frames' refs interleave.
 */
export function markShownAtScript(indices: readonly number[]): string {
  return `(() => typeof window.__bingbongMarkShownAt === 'function' ? window.__bingbongMarkShownAt(${JSON.stringify(indices)}) : false)()`
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
  /** The target's centre, when something covers it there: the click is then at a part that shows (x, y), or blocked. */
  coveredCentre?: { x: number; y: number }
  /**
   * No part of the target shows, but everything over it at (x, y) is a Blank
   * Cover — paints nothing there: no background, border, shadow, image or
   * text of its own — so a person sees the target and the click activates it
   * directly, as a Vimium hint does (DuckDuckGo's empty header aside over
   * its whole Search button at the zoomed pane, 2026-10-18).
   */
  blankCover?: true
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
 * Where the frame in this document's `window.frames[slot]` starts in this
 * document's viewport (#377): its iframe's content-box origin, or null when
 * no iframe holds that frame now. Summed up a frame's ancestors, it is
 * what a click on the frame's element is offset by.
 */
export function frameBoxScript(slot: number): string {
  return `(() => {
    /* FRAME_BOX */
    const slotOf = ${FRAME_SLOT_FN}
    const iframe = Array.from(document.querySelectorAll('iframe')).find((candidate) => slotOf(candidate) === ${slot})
    return iframe ? ${FRAME_BOX_FN}(iframe) : null
  })()`
}

/** The scroller a scroll event on the document is about. */
const ROOT_SCROLLER = '(document.scrollingElement || document.documentElement)'

/**
 * The grid a click prep samples over a target whose centre is covered: a
 * point every fifth of its width and every half of its height, so a button
 * that shows only its left third still has a column of points in it.
 */
const SAMPLE_COLUMNS = 6
const SAMPLE_ROWS = 3

/** Where a scroller stands, as the click prep and the readiness watch compare it (#335). */
const SCROLL_SPOT = "(node) => node.scrollLeft + ',' + node.scrollTop"

/**
 * Scroll the registry node at this index into view (instantly, and told to
 * an armed readiness watch so the scroll is never the click's effect —
 * #335) and hit-test its centre
 * with `elementsFromPoint`, which returns the whole paint-order stack (ADR
 * 0062). The target on top (or under its own descendant) is clickable, at
 * its centre or, when that is covered, at the point of it nearest the
 * centre that shows (DuckDuckGo's header aside over its Search button's
 * centre at a 985 px pane, 2026-10-18); a target no part of which shows is
 * judged at its centre: the
 * target in the stack under something else is Covered, and the entries
 * above it are the covers; the target absent from the stack is Not Shown —
 * inert, clipped, hidden or `pointer-events: none`, which no dismissal
 * reaches. Covers that all paint nothing at the centre — no background,
 * border, shadow, image, pseudo-element or text of their own there — are a
 * Blank Cover: the target is what a person sees, and the click activates
 * it directly (`blankCover`), as a Vimium hint does; a modal dialog is
 * never blank. A cover is the first entry above that is a nameable ref or
 * lies inside one; else the first with an accessible name, by role and
 * name; else the top entry's tag — the last two with up to three refs inside.
 */
export function clickPrepScript(index: number, naming: CoverNaming): string {
  return `(() => {
    const tagOf = ${TAG_OF_FN}
    const sourceFreeText = ${SOURCE_FREE_TEXT_FN}
    const el = (window.__bingbongRefs || [])[${index}]
    if (!el || !el.isConnected) return { ok: false }
    const scrollers = [${ROOT_SCROLLER}]
    for (let n = el.parentElement; n !== null && n !== scrollers[0]; n = n.parentElement) scrollers.push(n)
    const spotOf = ${SCROLL_SPOT}
    const before = scrollers.map(spotOf)
    // Instant, whatever the page's scroll-behavior: the hit test below reads
    // where the scroll ends, not a frame of a smooth one (#335).
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    // Where this scroll moved a scroller to, told to an armed readiness
    // watch: the scroll event it fires there is ours, never the click's
    // effect (#335).
    const ready = window.__bingbongReady
    if (ready && ready.ownScroll instanceof Map) {
      scrollers.forEach((node, i) => {
        const spot = spotOf(node)
        if (spot !== before[i]) ready.ownScroll.set(node, spot)
      })
    }
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
    // Hit-tested in the target's own tree: in an open shadow root (#381) the
    // document's answers its host.
    const tree = el.getRootNode()
    const stack = tree.elementsFromPoint(x, y)
    const top = stack.length > 0 ? stack[0] : null
    const reaches = (hit) => hit === el || (hit !== null && el.contains(hit))
    if (reaches(top)) return { ok: true, x, y, clickable: true }
    // The centre is covered, but a person clicks the part that shows: any
    // point of the visible rect where the target is on top, the one nearest
    // the centre first. Covered only when no part of it shows.
    const inset = 2
    const left = visibleLeft + inset
    const right = visibleRight - 1 - inset
    const upper = visibleTop + inset
    const lower = visibleBottom - 1 - inset
    if (right > left && lower > upper) {
      const points = []
      for (let i = 0; i <= ${SAMPLE_COLUMNS - 1}; i++) {
        for (let j = 0; j <= ${SAMPLE_ROWS - 1}; j++) {
          points.push([Math.round(left + ((right - left) * i) / ${SAMPLE_COLUMNS - 1}), Math.round(upper + ((lower - upper) * j) / ${SAMPLE_ROWS - 1})])
        }
      }
      points.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))
      for (const [px, py] of points) {
        if (reaches(tree.elementFromPoint(px, py))) return { ok: true, x: px, y: py, clickable: true, coveredCentre: { x, y } }
      }
    }
    const at = stack.indexOf(el)
    // A modal <dialog> makes everything outside it inert without an inert
    // attribute, so the hit test skips a target it merely covers: that
    // target is Covered by the modal, and keeps ADR 0061's consent retry.
    const modal = document.querySelector('dialog:modal')
    const underModal = at < 0 && modal !== null && !modal.contains(el)
    if (at < 0 && !underModal) return { ok: true, x, y, clickable: false, blocked: { fact: 'notShown' } }
    const covered = (cover) => ({ ok: true, x, y, clickable: false, blocked: { fact: 'covered', cover }, coveredCentre: { x, y } })
    const above = underModal ? [modal] : stack.slice(0, at).filter((entry) => !el.contains(entry) && !entry.contains(el))
    // A Blank Cover: every entry over the target paints nothing at the
    // point, so a person sees the target there and the click activates it
    // directly. Anything an entry draws itself at the point — a background
    // or image, a border or shadow, a pseudo-element, text of its own — makes
    // it a real cover; what its descendants draw is theirs, and they are in
    // the stack on their own. A modal dialog is never blank. Any doubt reads
    // as painted.
    const alphaOf = (color) => {
      if (!color || color === 'transparent') return 0
      const legacy = /^rgba?\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*(?:,\\s*([\\d.]+%?))?\\s*\\)$/.exec(color)
      const modern = legacy ? null : /\\/\\s*([\\d.]+%?)\\s*\\)$/.exec(color)
      const alpha = legacy ? legacy[1] : modern ? modern[1] : undefined
      // A colour in a syntax not read here is taken as painted.
      if (alpha === undefined) return 1
      return alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)
    }
    const PAINTED_TAGS = ['IMG', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'PICTURE', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'DIALOG', 'HR', 'PROGRESS', 'METER']
    const SIDES = ['Top', 'Right', 'Bottom', 'Left']
    const drawsBox = (style) =>
      alphaOf(style.backgroundColor) > 0 ||
      style.backgroundImage !== 'none' ||
      style.boxShadow !== 'none' ||
      SIDES.some((side) => parseFloat(style['border' + side + 'Width']) > 0 && style['border' + side + 'Style'] !== 'none' && alphaOf(style['border' + side + 'Color']) > 0) ||
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0)
    const paintsNothingAt = (entry, px, py) => {
      if (!(entry instanceof Element) || PAINTED_TAGS.includes(tagOf(entry).toUpperCase())) return false
      const role = entry.getAttribute('role')
      if (role === 'dialog' || role === 'alertdialog') return false
      const style = getComputedStyle(entry)
      if (style.opacity === '0') return true
      if (drawsBox(style)) return false
      for (const pseudo of ['::before', '::after']) {
        const drawn = getComputedStyle(entry, pseudo)
        const content = drawn.content
        if (content && content !== 'none' && content !== 'normal' && (content !== '""' || drawsBox(drawn))) return false
      }
      for (const node of entry.childNodes) {
        if (node.nodeType !== 3 || node.textContent.trim() === '') continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const r of range.getClientRects()) {
          if (px >= r.left && px < r.right && py >= r.top && py < r.bottom) return false
        }
      }
      return true
    }
    if (!underModal && above.length > 0 && above.every((entry) => paintsNothingAt(entry, x, y))) {
      return { ok: true, x, y, clickable: false, blankCover: true, coveredCentre: { x, y } }
    }
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
      if (labelledBy) parts.push(labelledBy.split(/\\s+/).map((id) => document.getElementById(id)).filter((source) => source).map((source) => sourceFreeText(source)).join(' '))
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
      if (name) return covered({ role: entry.getAttribute('role') || IMPLICIT_ROLES[tagOf(entry)] || tagOf(entry).toLowerCase(), name, contains: contained(entry) })
    }
    const first = above.length > 0 ? above[0] : stack[0]
    return covered({ tag: tagOf(first).toLowerCase(), contains: contained(first) })
  })()`
}


/** How long a blurred field's popup is given to close (#336's search box, 2026-10-18): autocompletes close a beat after the blur, so a pick can land first. */
const POPUP_CLOSE_MS = 500

/**
 * A click Covered while another text field holds the focus: the field's own
 * popup — suggestions an earlier click into it opened — is what a person's
 * click elsewhere would close, so the field is blurred, as that click
 * would blur it. Resolves true once the target shows at (x, y) again, false
 * when no other field held the focus, or when the cover outlasts the wait
 * (it was no popup of the field's): the block then stands.
 */
export function blurFocusedFieldScript(index: number, x: number, y: number): string {
  return `(() => {
    /* BLUR_FOCUSED_FIELD */
    const tagOf = ${TAG_OF_FN}
    const el = (window.__bingbongRefs || [])[${index}]
    const field = document.activeElement
    if (!el || !field || field === document.body || field === el || field.contains(el) || el.contains(field)) return false
    const TEXT_TYPES = ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']
    const textual = field.isContentEditable || tagOf(field) === 'TEXTAREA' || (tagOf(field) === 'INPUT' && TEXT_TYPES.includes((field.getAttribute('type') || '').toLowerCase()))
    if (!textual) return false
    field.blur()
    const reaches = () => { const hit = el.getRootNode().elementFromPoint(${x}, ${y}); return hit === el || (hit !== null && el.contains(hit)) }
    const started = performance.now()
    return new Promise((resolve) => {
      const check = () => {
        if (reaches()) return resolve(true)
        if (performance.now() - started > ${POPUP_CLOSE_MS}) return resolve(false)
        setTimeout(check, 25)
      }
      check()
    })
  })()`
}

/**
 * Arm the page's readiness watch (#324, ADR 0076): from here the page
 * records the first thing an action does to it — a DOM mutation, an input
 * event, a scroll — so the post-action wait ends at that effect and never
 * at a fixed sleep. Re-arming replaces the watch before it.
 */
export function readinessArmScript(): string {
  return `(() => {
    /* READY_ARM */
    const previous = window.__bingbongReady
    if (previous && typeof previous.stop === 'function') previous.stop()
    // ownScroll: where a click's own scroll-into-view moved each scroller
    // (clickPrepScript); the first scroll event that finds its scroller
    // still there is that scroll's, not the page's, and spends it (#335).
    const state = { fired: null, waiters: [], stop: () => {}, wait: null, ownScroll: new Map() }
    const fire = (kind) => {
      if (state.fired !== null) return
      state.fired = kind
      state.stop()
      for (const resolve of state.waiters.splice(0)) resolve(kind)
    }
    const observer = new MutationObserver(() => fire('mutation'))
    observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, characterData: true })
    const onInput = () => fire('input')
    const spotOf = ${SCROLL_SPOT}
    const onScroll = (event) => {
      const node = event.target === document ? ${ROOT_SCROLLER} : event.target
      const own = state.ownScroll.get(node)
      state.ownScroll.delete(node)
      if (own !== undefined && own === spotOf(node)) return
      fire('scroll')
    }
    window.addEventListener('input', onInput, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    state.stop = () => {
      observer.disconnect()
      window.removeEventListener('input', onInput, { capture: true })
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
    state.wait = (ms) => new Promise((resolve) => {
      if (state.fired !== null) return resolve(state.fired)
      state.waiters.push(resolve)
      setTimeout(() => fire('timeout'), ms)
    })
    window.__bingbongReady = state
    return true
  })()`
}

/**
 * Wait for the armed watch's first effect, at most `ms` (#324). Evaluated
 * with `awaitPromise`. Answers `none` when no watch is armed in this
 * document — the one the action armed went with the page.
 */
export function readinessWaitScript(ms: number): string {
  return `(() => {
    /* READY_WAIT */
    const state = window.__bingbongReady
    return state && typeof state.wait === 'function' ? state.wait(${ms}) : 'none'
  })()`
}

/**
 * A page scroll's end (#383): Chromium animates the End and Home keys and
 * the wheel, and the readiness watch hears the first frame, so the scroll
 * is read once it has stopped — at the first `scrollend` of any scroller,
 * or once no scroll event has come for `stillMs` — and at `capMs` at most.
 * Evaluated with `awaitPromise`.
 */
export function scrollSettledScript(stillMs: number, capMs: number): string {
  return `new Promise((resolve) => {
    /* SCROLL_SETTLED */
    let still = null
    const end = (settled) => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('scrollend', onEnd, { capture: true })
      clearTimeout(still)
      clearTimeout(cap)
      resolve(settled)
    }
    const onEnd = () => end(true)
    const onScroll = () => {
      clearTimeout(still)
      still = setTimeout(() => end(true), ${stillMs})
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('scrollend', onEnd, { capture: true, passive: true })
    onScroll()
    const cap = setTimeout(() => end(false), ${capMs})
  })`
}

/**
 * A landing's quiet window (#328): resolves `true` once the main document
 * has gone this many ms with no mutation, the readiness watch's observer
 * re-armed on every change. It lets go of itself at the cap (`false`), so
 * a page that never goes quiet keeps no observer.
 */
export function domQuietScript(quietMs: number, capMs: number): string {
  return `new Promise((resolve) => {
    /* DOM_QUIET */
    let timer = null
    let cap = null
    const end = (quiet) => {
      observer.disconnect()
      clearTimeout(timer)
      clearTimeout(cap)
      resolve(quiet)
    }
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => end(true), ${quietMs})
    })
    observer.observe(document.documentElement || document, { subtree: true, childList: true, attributes: true, characterData: true })
    timer = setTimeout(() => end(true), ${quietMs})
    cap = setTimeout(() => end(false), ${capMs})
  })`
}

/** Light the element at this zero-based registry position for a moment (#324): the Command's chosen ref, as the click lands. */
export function flashRefScript(index: number): string {
  return `(() => {
    /* FLASH_REF */
    const el = (window.__bingbongRefs || [])[${index}]
    if (!el || !el.isConnected || !el.style) return false
    const outline = el.style.outline
    const offset = el.style.outlineOffset
    el.style.outline = '3px solid #4c9ffe'
    el.style.outlineOffset = '2px'
    setTimeout(() => {
      el.style.outline = outline
      el.style.outlineOffset = offset
    }, 400)
    return true
  })()`
}

/**
 * Clear the focused editable element (#324): an input, a textarea or a
 * contenteditable. The value is set through the prototype's setter so a
 * framework-bound field notices, and an input event follows. Answers what
 * was cleared, or null when nothing editable has focus.
 */
export function clearFocusedScript(): string {
  return `(() => {
    /* CLEAR_FOCUSED */
    const tagOf = ${TAG_OF_FN}
    const el = document.activeElement
    if (!el || el === document.body) return null
    const tag = tagOf(el).toLowerCase()
    if (tag === 'input' || tag === 'textarea') {
      const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
      if (descriptor && descriptor.set) descriptor.set.call(el, '')
      else el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return tag === 'input' ? 'input[' + (el.type || 'text') + ']' : 'textarea'
    }
    if (el.isContentEditable) {
      el.textContent = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'editable ' + tag
    }
    return null
  })()`
}
