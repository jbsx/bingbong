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
    ['complete args', 'type', '{"ref":7,"text":"mechanical keyboards"}', 'typing \'mechanical keyboards\'…'],
    ['target still streaming', 'click', '{"ref":"Sea', 'clicking \'Sea…\''],
    ['name only, args not started', 'click', '', 'clicking…'],
    ['key arrived, value not started', 'type', '{"text":', 'typing…'],
    ['navigate url partial', 'navigate', '{"url":"https://you', 'opening \'https://you…\''],
    ['type partial', 'type', '{"ref":4,"text":"hello wo', 'typing \'hello wo…\''],
    ['numeric target streams raw', 'click', '{"ref":1', 'clicking \'1…\''],
    ['escapes unescape as they close', 'navigate', '{"url":"https://x.test/?q=say \\"hi\\"', 'opening \'https://x.test/?q=say "hi"…\''],
    ['ask_user', 'ask_user', '{"question":"which one?', 'asking you \'which one?…\''],
    ['spawn_agent names the kind', 'spawn_agent', '{"kind":"browse","task":"compare keyboards', 'spawning browse agent: \'compare keyboards…\''],
    ['no-args tool is the verb alone', 'read_page', '{}', 'reading the page…'],
    ['panel toggle is the verb alone', 'toggle_panel', '{}', 'toggling the panel…'],
    ['panel mode streams its target', 'set_panel_mode', '{"mode":"dock', "setting panel mode 'dock…'"],
    ['panel width streams its direction', 'set_panel_width', '{"direction":"wid', "setting panel width 'wid…'"],
    ['panel width streams its preset', 'set_panel_width', '{"preset":"half_scr', "setting panel width 'half_scr…'"],
    ['go_forward parity with back', 'go_forward', '{}', 'going forward…'],
    ['set_setting streams its target', 'set_setting', '{"setting":"weather_city', "setting 'weather_city…'"],
    ['app_control streams its action', 'app_control', '{"action":"qu', "app 'qu…'"],
    ['unknown tool falls back to its name', 'mystery_tool', '{"x":1}', 'calling mystery_tool…'],
  ])('maps %s to an intent phrase', (_name, tool, args, expected) => {
    expect(describeToolIntent(tool, args)).toBe(expected)
  })

  it('agrees with the outcome phrase once the args are complete', () => {
    const args = '{"ref":7,"text":"mechanical keyboards\\n"}'
    // The streamed value's escapes unescape, so the newline is real here.
    expect(describeToolIntent('type', args)).toBe('typing \'mechanical keyboards\n\'…')
    expect(describeToolAction('type', { ref: 7, text: 'mechanical keyboards\n' })).toBe('type "mechanical keyboards\n" into [7]')
  })

  it('renders set_setting and app_control calls as compact feed lines', () => {
    expect(describeToolAction('set_setting', { setting: 'weather_city', string_value: 'Berlin' })).toBe(
      'set weather_city to Berlin',
    )
    expect(
      describeToolAction('set_setting', { setting: 'model_routing_model', role: 'subagent', string_value: 'deepseek-chat' }),
    ).toBe('set model_routing_model (subagent) to deepseek-chat')
    expect(describeToolAction('app_control', { action: 'quit' })).toBe('app quit')
  })

  it('renders set_panel_width as relative moves — never a pixel count', () => {
    expect(describeToolAction('set_panel_width', { direction: 'wider' })).toBe('panel width wider')
    expect(describeToolAction('set_panel_width', { direction: 'narrower', steps: 2 })).toBe('panel width narrower ×2')
    expect(describeToolAction('set_panel_width', { preset: 'half_screen' })).toBe('panel width half screen')
  })

  it('is monotonic as fragments arrive — the line only grows', () => {
    const fragments = ['{"te', 'xt":"mech', 'anical key', 'boards"}']
    const phrases = fragments.map((_, i) => describeToolIntent('type', fragments.slice(0, i + 1).join('')))
    // Trailing ellipsis/quote markers shift when a value closes; the words
    // themselves never regress.
    const stripped = (phrase: string): string => phrase.replace(/…'?$/, '')
    for (let i = 1; i < phrases.length; i += 1) {
      expect(phrases[i]!.startsWith(stripped(phrases[i - 1]!))).toBe(true)
    }
    expect(phrases.at(-1)).toBe("typing 'mechanical keyboards'…")
  })
})
