import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createTurnCardFold, type TurnCardState } from '../../core/idle/turnCard'
import { TurnCard } from './TurnCard'

// The Turn Card's drawing (#474): the rail lit at the station, the stage
// word in the Capsule's words, the words row, six history rows always
// drawn (blank ones kept), the end said in words and in its tone.

const render = (state: TurnCardState): string => renderToStaticMarkup(createElement(TurnCard, { state, onDismiss: () => undefined }))
const text = (html: string, selector: string): string[] => [...html.matchAll(new RegExp(`class="${selector}[^"]*"[^>]*>([^<]*)<`, 'g'))].map((m) => m[1]!)

function listening(): TurnCardState {
  const fold = createTurnCardFold()
  fold.onVoice({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: true, since: Date.now() - 1_200 }, Date.now())
  fold.onPartial('set a timer for five')
  return fold.state()
}

function done(): TurnCardState {
  const fold = createTurnCardFold()
  const at = Date.now() - 6_000
  fold.onVoice({ listening: true, reason: 'wake', monitoring: true, transcribing: false, hearing: true, since: at }, at)
  fold.onPartial('set a timer for five minutes')
  fold.onVoice({ listening: false, reason: null, monitoring: true, transcribing: true, hearing: false, since: at + 1_000 }, at + 1_000)
  fold.onVoice({ listening: false, reason: null, monitoring: true, transcribing: false, hearing: false, since: at + 2_000 }, at + 2_000)
  fold.onHeard({ text: 'set a timer for five minutes', routed: 'command', at: at + 2_000 })
  fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'set a timer for five minutes', at: at + 2_000 })
  fold.onEvent({ type: 'command', turnId: 't1', text: 'set a timer for five minutes', action: 'timer 5m', keepsIdle: true, task: { id: 't1', hop: 0 }, at: at + 2_100 })
  fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Setting', detail: 'a 5 minute timer', at: at + 2_100 })
  fold.onEvent({ type: 'speak', turnId: 't1', text: 'Timer set, 5 minutes', at: at + 2_200 })
  fold.onEvent({ type: 'display', turnId: 't1', text: 'Timer set, 5 minutes', at: at + 2_200 })
  fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: at + 2_300 })
  fold.onEvent({ type: 'spoken', turnId: 't1', at: at + 4_000 })
  return fold.state()
}

describe('the Turn Card', () => {
  it('while the ear hears: Listening… at the stage word, the waveform as its mark, the live words in full, no station lit', () => {
    const html = render(listening())
    expect(html).toContain('data-state="listening"')
    expect(text(html, 'turn-stage-word')).toEqual(['Listening…'])
    expect(html).toContain('voice-wave')
    expect(html).not.toContain('turn-stage-secs')
    expect(text(html, 'turn-words')).toEqual(['“set a timer for five…”'])
    expect(html.match(/turn-rail-cell--ahead/g)).toHaveLength(6)
    expect(html).toContain('turn-track-fill--none')
    expect(text(html, 'turn-rail-label')).toEqual(['Heard', 'Thinking', 'Acting', 'Loading', 'Speaking', 'Done'])
    // Six rows always: one drawn, five blank.
    expect(html.match(/class="turn-step turn-step--(?!blank)/g)).toHaveLength(1)
    expect(html.match(/turn-step--blank/g)).toHaveLength(5)
    expect(text(html, 'turn-step-label')).toEqual(['Listening'])
  })

  it('once done: Done in its tone at the last station, the Answer in the words row, the end row last, the linger bar drawn', () => {
    const html = render(done())
    expect(html).toContain('data-state="done"')
    expect(html).toContain('turn-card--tone-ok')
    expect(text(html, 'turn-stage-word')).toEqual(['Done'])
    expect(text(html, 'turn-stage-secs')).toEqual(['2.3s'])
    expect(text(html, 'turn-words')).toEqual(['Timer set, 5 minutes'])
    expect(html).toContain('turn-rail-cell--live"><span class="turn-rail-dot"></span><span class="turn-rail-label">Done')
    expect(html.match(/turn-rail-cell--past/g)).toHaveLength(5)
    expect(text(html, 'turn-step-label')).toEqual(['Heard', 'Thinking', 'Read as', 'Setting', 'Speaking', 'Done'])
    expect(text(html, 'turn-step-at')).toEqual(['2.0s', '2.0s', '2.1s', '2.1s', '2.2s', '2.3s'])
    expect(html).toContain('turn-step--ok turn-step--newest')
    expect(html).toContain('turn-linger')
  })
})
