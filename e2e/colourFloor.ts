// The colour floor (#437, docs/agents/ui.md principles 5, 7 and 8), as an
// expression evaluated in a surface: the issues it finds, as strings.
//
// - In dark, every element with its own text clears 7:1 against its ground:
//   the text's colour composited (its alpha and every ancestor's opacity) over
//   the backgrounds behind it, down to the black ground.
// - Every element with its own text is set in Inter or JetBrains Mono.
// - At rest, the accent marks only what is live: nothing outside the Status
//   Capsule, the Voice Prompt, the Idle Screen's voice line, a primary button
//   or the focused control takes the accent's colour.
// - No colour sits in the accent's or the failure's hue band without being
//   that colour, so peach and coral each keep one meaning (a data series is
//   exempt from the five meaningful colours, never from the bands).

/** Degrees either side of the accent's and the failure's hue that another saturated colour may not take. */
export const HUE_BAND = 14

export const colourFloor = (rest: boolean): string => `(() => {
  const issues = []
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const rgb = (c) => 'rgb(' + [c.r, c.g, c.b].map(Math.round).join(', ') + ')'
  const hue = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); if (mx === mn) return null; const d = mx - mn; const h = mx === c.r ? ((c.g - c.b) / d) % 6 : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4; return (h * 60 + 360) % 360 }
  const saturated = (c) => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx > 0 && (mx - mn) / mx > 0.35 }
  const token = (name) => { const probe = document.createElement('i'); probe.style.color = 'var(' + name + ')'; document.body.append(probe); const c = parse(getComputedStyle(probe).color); probe.remove(); return c }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className !== '' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()
    const words = (el.value || el.placeholder || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
    return cls + ' "' + words + '"'
  }
  const shown = (el) => { const box = el.getBoundingClientRect(); const s = getComputedStyle(el); return box.width > 1 && box.height > 1 && s.visibility !== 'hidden' && Number(s.opacity) !== 0 }
  const groundOf = (el) => {
    const layers = []
    // An ancestor's ::before or ::after drawn behind it (today's square on the calendar) is ground too; a mark beside it (the index bar) is not.
    const covers = (n, p) => p.content !== 'none' && p.content !== 'normal' && p.position === 'absolute' && parseFloat(p.width) >= n.getBoundingClientRect().width / 2
    const fills = (n) => [getComputedStyle(n).backgroundColor, ...['::before', '::after'].map((pseudo) => getComputedStyle(n, pseudo)).filter((p) => covers(n, p)).map((p) => p.backgroundColor)].map(parse).filter((c) => c && c.a > 0)
    outer: for (let n = el; n; n = n.parentElement) for (const c of fills(n).reverse()) { layers.push(c); if (c.a >= 0.99) break outer }
    let base = dark ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
    if (layers.length && layers[layers.length - 1].a >= 0.99) base = layers.pop()
    for (const l of layers.reverse()) base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }
    return base
  }
  const accent = token('--accent')
  const fail = token('--fail')
  const failText = token('--fail-text')
  const same = (a, b) => a && b && Math.abs(a.r - b.r) < 1.5 && Math.abs(a.g - b.g) < 1.5 && Math.abs(a.b - b.b) < 1.5
  const inBand = (c) => { const h = hue(c); if (h === null || !saturated(c)) return false; return [accent, fail].some((t) => { const d = Math.abs(h - hue(t)); return Math.min(d, 360 - d) <= ${HUE_BAND} }) }
  const LIVE = '.status-capsule, .voice-prompt, .idle-voice, .settings-button--primary, .prompt-verb'
  for (const el of document.querySelectorAll('body *')) {
    // Text nobody sees: skipped by content-visibility (a Feed run scrolled away) or under an ancestor at no opacity.
    if (el.closest('option, .feed-sr') || !shown(el) || !el.checkVisibility({ contentVisibilityAuto: true })) continue
    let opacity = 1
    let moving = false
    for (let n = el; n; n = n.parentElement) {
      opacity *= Number(getComputedStyle(n).opacity)
      if (n.getAnimations().some((animation) => animation.playState === 'running')) moving = true
    }
    if (opacity < 0.02) continue
    const s = getComputedStyle(el)
    const field = (el instanceof HTMLInputElement && ['text', 'search', 'url', 'number', 'date', 'email', 'tel', 'password'].includes(el.type)) || el instanceof HTMLTextAreaElement
    const own = !el.closest('svg') && (field ? (el.value || el.placeholder) !== '' : !(el instanceof HTMLInputElement) && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== ''))
    if (own && !(el.closest('[aria-hidden="true"]') && el.closest('.feed-surface'))) {
      const family = s.fontFamily.split(',')[0].trim().replace(/["']/g, '')
      if (!/^(Inter|JetBrains Mono)/.test(family)) issues.push('typeface ' + family + ': ' + name(el))
      // A fade in flight (under 300 ms, principle 4) or a pulse is read at rest, not mid-way.
      if (dark && !(moving && opacity < 1)) {
        const fg = parse(field && !el.value ? getComputedStyle(el, '::placeholder').color : s.color)
        // Transparent text is drawn by another element over it (the address field's display).
        if (fg && fg.a > 0) {
          const ground = groundOf(el)
          const a = fg.a * opacity
          const mix = { r: fg.r * a + ground.r * (1 - a), g: fg.g * a + ground.g * (1 - a), b: fg.b * a + ground.b * (1 - a) }
          const L1 = lum(mix), L2 = lum(ground)
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
          if (ratio < 7) issues.push('contrast ' + ratio.toFixed(2) + ':1 (' + rgb(mix) + ' on ' + rgb(ground) + '): ' + name(el))
        }
      }
    }
    // Every colour the element draws in: its text, its fill, its edges, its marks.
    const borders = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => parseFloat(s['border' + side + 'Width']) > 0).map((side) => s['border' + side + 'Color'])
    // A mark drawn by ::before or ::after (the Settings index mark, today's ring) is the element's too.
    const marks = ['::before', '::after'].map((pseudo) => getComputedStyle(el, pseudo)).filter((p) => p.content !== 'none' && p.content !== 'normal').flatMap((p) => [p.backgroundColor, p.borderTopColor && parseFloat(p.borderTopWidth) > 0 ? p.borderTopColor : null])
    const drawn = [own ? s.color : null, s.backgroundColor, ...borders, ...marks, el.closest('svg') ? s.fill : null, el.closest('svg') ? s.stroke : null, s.outlineStyle !== 'none' ? s.outlineColor : null, el instanceof HTMLInputElement && ['range', 'checkbox', 'radio'].includes(el.type) ? s.accentColor : null]
      .map(parse)
      .filter((c) => c && c.a > 0.05)
    if (${rest ? 'true' : 'false'} && !el.closest(LIVE) && el !== document.activeElement && drawn.some((c) => same(c, accent))) issues.push('accent at rest: ' + name(el))
    const near = drawn.find((c) => inBand(c) && !same(c, accent) && !same(c, fail) && !same(c, failText))
    if (near) issues.push('in the accent or failure hue (' + rgb(near) + '): ' + name(el))
  }
  return issues
})()`
