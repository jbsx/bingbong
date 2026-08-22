import { describe, expect, it } from 'vitest'
import { describeToolAction, describeToolIntent } from './toolCallDisplay'

// Tool-call intent (#48): while tool-call arguments stream, the feed shows
// what is about to happen ("clicking 'Search'…") before the tool executes.
// The phrase derives from the tool name plus a best-effort read of the
// partial arguments JSON — a still-open string value shows everything
// received so far, so the line grows as the model types. Table-driven like
// the feed projection's suite; the outcome phrases (describeToolAction)
// ride along for context.

describe('describeToolIntent', () => {
  it.each([
    ['complete args', 'web_search', '{"query":"mechanical keyboards"}', 'searching for \'mechanical keyboards\'…'],
    ['target still streaming', 'click', '{"ref":"Sea', 'clicking \'Sea…\''],
    ['name only, args not started', 'click', '', 'clicking…'],
    ['key arrived, value not started', 'web_search', '{"query":', 'searching for…'],
    ['navigate url partial', 'navigate', '{"url":"https://you', 'opening \'https://you…\''],
    ['type partial', 'type', '{"ref":4,"text":"hello wo', 'typing \'hello wo…\''],
    ['numeric target streams raw', 'click', '{"ref":1', 'clicking \'1…\''],
    ['escapes unescape as they close', 'web_search', '{"query":"say \\"hi\\"', 'searching for \'say "hi"…\''],
    ['ask_user', 'ask_user', '{"question":"which one?', 'asking you \'which one?…\''],
    ['spawn_agent names the kind', 'spawn_agent', '{"kind":"research","task":"compare keyboards', 'spawning research agent: \'compare keyboards…\''],
    ['no-args tool is the verb alone', 'read_page', '{}', 'reading the page…'],
    ['panel toggle is the verb alone', 'toggle_panel', '{}', 'toggling the panel…'],
    ['panel mode streams its target', 'set_panel_mode', '{"mode":"dock', "setting panel mode 'dock…'"],
    ['unknown tool falls back to its name', 'mystery_tool', '{"x":1}', 'calling mystery_tool…'],
  ])('maps %s to an intent phrase', (_name, tool, args, expected) => {
    expect(describeToolIntent(tool, args)).toBe(expected)
  })

  it('agrees with the outcome phrase once the args are complete', () => {
    const args = '{"query":"mechanical keyboards"}'
    expect(describeToolIntent('web_search', args)).toBe("searching for 'mechanical keyboards'…")
    expect(describeToolAction('web_search', { query: 'mechanical keyboards' })).toBe('search "mechanical keyboards"')
  })

  it('is monotonic as fragments arrive — the line only grows', () => {
    const fragments = ['{"qu', 'ery":"mech', 'anical key', 'boards"}']
    const phrases = fragments.map((_, i) => describeToolIntent('web_search', fragments.slice(0, i + 1).join('')))
    // Trailing ellipsis/quote markers shift when a value closes; the words
    // themselves never regress.
    const stripped = (phrase: string): string => phrase.replace(/…'?$/, '')
    for (let i = 1; i < phrases.length; i += 1) {
      expect(phrases[i]!.startsWith(stripped(phrases[i - 1]!))).toBe(true)
    }
    expect(phrases.at(-1)).toBe("searching for 'mechanical keyboards'…")
  })
})
