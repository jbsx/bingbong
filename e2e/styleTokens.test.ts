import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The token guard (#455, docs/agents/ui.md principle 7): two typefaces and
// four sizes, since every size is a rank to learn. Every font-size in the
// renderer CSS is a step of the ladder (--type-s/m/l/xl), every radius a
// radius token, every face a face token; the display numerals marked
// data-display keep their own sizes and are listed below, one reason each.
// It reads the sheets from disk, not through an import: vitest blanks CSS.

const SHEETS = ['styles.css', 'overlay.css']

type Declaration = { sheet: string; selector: string; property: string; value: string }

/** Every declaration in a sheet with the selector (or at-rule) of the block it sits in. */
function declarations(sheet: string): Declaration[] {
  const css = readFileSync(new URL(`../src/renderer/src/${sheet}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Declaration[] = []
  const stack: string[] = []
  let text = ''
  const take = (): void => {
    const colon = text.indexOf(':')
    if (colon > 0 && stack.length > 0) {
      out.push({ sheet, selector: stack[stack.length - 1], property: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() })
    }
    text = ''
  }
  for (const ch of css) {
    if (ch === '{') {
      stack.push(text.replace(/\s+/g, ' ').trim())
      text = ''
    } else if (ch === '}') {
      take()
      stack.pop()
    } else if (ch === ';') take()
    else text += ch
  }
  return out
}

const ALL = SHEETS.flatMap(declarations)
const where = (d: Declaration): string => `${d.sheet} ${d.selector} { ${d.property}: ${d.value} }`

/** The sizes off the ladder, each a display numeral (or a part of one) or the root. */
const SIZE_ALLOWLIST: readonly { selector: string; value: string; reason: string }[] = [
  { selector: 'html', value: 'calc(var(--type-s) * var(--font-scale))', reason: 'the root size: the small step times the one calibration knob' },
  { selector: '.idle-clock', value: '176px', reason: 'the Idle Screen clock, display numeral (owner 2026-10-25)' },
  { selector: '.idle-clock-tail', value: '0.3em', reason: "the clock's seconds and pm, part of the clock numeral" },
  { selector: '.idle-clock-block--split .idle-clock, .idle-timer-left', value: '112px', reason: 'the clock beside a Timer, and the Timer Clock, display numerals' },
  { selector: '.idle-timer--ringing .idle-timer-left', value: '84px', reason: "the Timer Clock's “Time’s up”, display" },
  { selector: '.usage-ring-pct', value: 'calc(var(--ring) * 0.28)', reason: 'a usage percentage, sized to its ring' },
  { selector: '.usage-ring-pct--wide', value: 'calc(var(--ring) * 0.22)', reason: 'a three-figure usage percentage, sized to its ring' },
  { selector: '.usage-ring-pct small', value: 'max(16px, 0.36em)', reason: "a usage percentage's % sign, part of the numeral" },
  { selector: ".usage-chart[data-lines='3'] .usage-last", value: '32px', reason: "a usage chart's end figures, display numeral" },
  { selector: '.idle-popup-place .weighin-popup-kg', value: '132px', reason: 'the weight, display numeral' },
  { selector: '.idle-popup-place .weighin-popup-kg small', value: '34px', reason: "the weight's kg, part of the numeral" },
  { selector: '.wx-hero', value: '172px', reason: 'the big temperature, display numeral' },
  { selector: '.wx-lohi', value: '28px', reason: "today's low and high, display numerals" },
  { selector: '.wx-peak-figure', value: '88px', reason: "the day's peak temperature, display numeral" },
  { selector: '.wx-peak-figure small', value: '0.42em', reason: "the peak's unit, part of the numeral" },
  { selector: '.wx-days-low, .wx-days-high', value: '28px', reason: "the week's lows and highs, display numerals" },
  { selector: '.idle-cal-today', value: '88px', reason: "the calendar's date, display numeral" },
  { selector: '.weight-card-kg', value: '68px', reason: 'the weight, display numeral' },
  { selector: '.weight-card-kg small', value: '20px', reason: "the weight's kg, part of the numeral" },
  { selector: '.weight-card-change', value: '38px', reason: "the weight's change, display numeral" },
  { selector: '.idle-repo-gain-figure', value: '2rem', reason: "a repo's stars this month, display numeral" },
  { selector: '.idle-repos--lean .idle-repo-gain-figure', value: '1.6rem', reason: "a repo's stars this month on a lean card, display numeral" },
  { selector: '.weight-figure-value', value: 'clamp(40px, 2.7vw, 52px)', reason: 'a body figure, display numeral' },
  { selector: '.weight-figure-unit', value: '0.42em', reason: "a body figure's unit, part of the numeral" },
  { selector: ".weight-figure[data-figure='weightKg'] .weight-figure-value", value: 'clamp(96px, 7.8vw, 150px)', reason: 'the weight, display numeral' },
  { selector: '.weight-figure-change', value: '17px', reason: "a body figure's change, display numeral" },
  { selector: ".weight-figure[data-figure='weightKg'] .weight-figure-change", value: '28px', reason: "the weight's change, display numeral" },
  { selector: '.weighin-popup-kg', value: '52px', reason: 'the weight, display numeral' },
  { selector: '.weighin-popup-kg small', value: '0.42em', reason: "the weight's kg, part of the numeral" },
]

const LADDER = /^var\(--type-(s|m|l|xl)\)$/
const RADIUS_PART = /^(var\(--radius(-sm|-md|-lg|-pill)?\)|0|50%|inherit)$/
const FACE = /^(var\(--font-(sans|mono)\)|inherit)$/

describe('the renderer CSS keeps to the tokens (#455)', () => {
  it('reads every sheet', () => {
    for (const sheet of SHEETS) expect(ALL.filter((d) => d.sheet === sheet).length).toBeGreaterThan(100)
  })

  it('sets every font size on the four-step ladder, or names it in the allowlist', () => {
    const allowed = (d: Declaration): boolean => SIZE_ALLOWLIST.some((a) => a.selector === d.selector && a.value === d.value)
    const off = ALL.filter((d) => d.property === 'font-size' && !LADDER.test(d.value) && d.value !== 'inherit' && !allowed(d))
    expect(off.map(where)).toEqual([])
  })

  it('carries no stale allowlist entry, and a reason on each', () => {
    const stale = SIZE_ALLOWLIST.filter((a) => !ALL.some((d) => d.property === 'font-size' && d.selector === a.selector && d.value === a.value))
    expect(stale).toEqual([])
    expect(SIZE_ALLOWLIST.filter((a) => a.reason.trim() === '')).toEqual([])
  })

  it('rounds every corner with a radius token', () => {
    const off = ALL.filter((d) => /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(d.property) && !d.value.split(/\s+/).every((part) => RADIUS_PART.test(part)))
    expect(off.map(where)).toEqual([])
  })

  it('sets every face with a face token', () => {
    const off = ALL.filter((d) => (d.property === 'font-family' || (d.property === 'font' && d.value !== 'inherit')) && d.selector !== '@font-face' && !FACE.test(d.value))
    expect(off.map(where)).toEqual([])
  })

  it('names ui-monospace and the sans stack only in their tokens', () => {
    const outside = (needle: RegExp, token: string): string[] =>
      ALL.filter((d) => needle.test(d.value) && d.property !== token).map(where)
    expect(outside(/ui-monospace/, '--font-mono')).toEqual([])
    expect(outside(/InterVariable\s*,/, '--font-sans')).toEqual([])
  })
})
