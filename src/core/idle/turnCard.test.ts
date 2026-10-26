import { describe, expect, it } from 'vitest'
import { PEEK_CARD_LINGER_MS } from '../panel/peekCardState'
import type { VoiceState } from '../voice/ipcChannels'
import { createTurnCardFold, NO_COMMAND, turnHistory, turnLive, turnStation, turnWords, type TurnCardFold } from './turnCard'

// The Turn Card's fold (#474): which seam fills which row, what is live,
// and when the card goes — 15 s after the later of `done` and the last
// sentence spoken, the Peek Card's own constant.

const REST: VoiceState = { listening: false, reason: null, monitoring: true, transcribing: false, hearing: false }
const voice = (over: Partial<VoiceState>): VoiceState => ({ ...REST, ...over })

/** A spoken line taken over the Idle Screen: the wake at 1000, speech at 1600, the Endpoint at 3300, read by 4400. */
function speak(fold: TurnCardFold, words: string, partials: string[] = [words]): void {
  fold.onVoice(voice({ listening: true, reason: 'wake', since: 1000 }), 1000)
  fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 1600 }), 1600)
  for (const partial of partials) fold.onPartial(partial)
  fold.onPartial('')
  fold.onVoice(voice({ transcribing: true, since: 3300 }), 3300)
  fold.onVoice(voice({ listening: true, reason: 'wake', since: 4400 }), 4400)
  fold.onHeard({ text: words, routed: 'command', at: 4400 })
}

const labels = (fold: TurnCardFold): string[] => fold.state().steps.map((step) => `${step.label}: ${step.text}`)

describe('the Turn Card fold', () => {
  it('opens on the wake and draws the live words in full as they come, then the Transcribing and Heard rows (AC1)', () => {
    const fold = createTurnCardFold()
    expect(fold.state().phase).toBe('hidden')
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 1000 }), 1000)
    expect(fold.state().phase).toBe('open')
    expect(fold.state().openedAt).toBe(1000)
    expect(turnLive(fold.state())).toEqual({ kind: 'ear', phase: 'listening', since: 1000 })
    expect(turnWords(fold.state())).toEqual({ text: 'say a command', tone: 'quiet' })
    expect(labels(fold)).toEqual(['Listening: say a command'])

    fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 1600 }), 1600)
    expect(turnWords(fold.state()).text).toBe('…')
    const long = 'play the latest video from the channel i was watching last night about the new phone'
    fold.onPartial('play the')
    fold.onPartial(long)
    expect(turnWords(fold.state())).toEqual({ text: `“${long}…”`, tone: 'plain' })
    // One Listening row, rewritten as the words come — not a row per partial.
    expect(labels(fold)).toEqual([`Listening: “${long}…”`])

    fold.onPartial('')
    fold.onVoice(voice({ transcribing: true, since: 3300 }), 3300)
    expect(turnLive(fold.state())).toEqual({ kind: 'ear', phase: 'transcribing', since: 3300 })
    expect(turnWords(fold.state()).text).toBe(`“${long}”`)
    fold.onHeard({ text: 'Play the latest video', routed: 'command', at: 4400 })
    expect(fold.state().heard).toBe('Play the latest video')
    expect(labels(fold).slice(-2)).toEqual([`Transcribing: “${long}”`, 'Heard: “Play the latest video”'])
    expect(turnStation(fold.state())).toBe(0)
  })

  it('closes again on a blip: the ear back at rest with nothing heard', () => {
    const fold = createTurnCardFold()
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 1000 }), 1000)
    fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 1200 }), 1200)
    fold.onVoice(voice({ since: 1500 }), 1500)
    // Within the grace the line's own seams may still come; past it the card goes.
    expect(fold.state().phase).toBe('open')
    expect(fold.state().retiresAt).toBe(2500)
    fold.expire(2500)
    expect(fold.state().phase).toBe('hidden')
  })

  it('draws every stage as it arrives with its detail, the rail at its station, Acting by its own word (AC2)', () => {
    const fold = createTurnCardFold()
    speak(fold, 'set a timer for five minutes')
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'set a timer for five minutes', at: 4400 })
    expect(turnLive(fold.state())).toMatchObject({ kind: 'stage', stage: { status: 'thinking', startedAt: 4400 } })
    expect(turnStation(fold.state())).toBe(1)
    expect(turnWords(fold.state())).toEqual({ text: '“set a timer for five minutes”', tone: 'plain' })
    // The same stage again on the same object is one row.
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'set a timer for five minutes', at: 4500 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'set a timer for five minutes', action: 'timer 5m', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 4600 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Setting', detail: 'a 5 minute timer', at: 4600 })
    expect(turnStation(fold.state())).toBe(2)
    expect(turnWords(fold.state()).text).toBe('a 5 minute timer')
    fold.onEvent({ type: 'status', turnId: 't1', status: 'loading', hop: 0, at: 5000 })
    // Loading with no detail is on what the action was on.
    expect(fold.state().stage).toMatchObject({ status: 'loading', word: 'Setting', detail: 'a 5 minute timer' })
    expect(turnStation(fold.state())).toBe(3)
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Timer set, 5 minutes', at: 5200 })
    expect(turnLive(fold.state())).toMatchObject({ kind: 'stage', stage: { status: 'speaking', startedAt: 5200 } })
    expect(turnStation(fold.state())).toBe(4)
    expect(turnWords(fold.state()).text).toBe('Timer set, 5 minutes')
    expect(labels(fold).slice(-5)).toEqual(['Thinking: “set a timer for five minutes”', 'Read as: timer 5m', 'Setting: a 5 minute timer', 'Loading: a 5 minute timer', 'Speaking: Timer set, 5 minutes'])
  })

  it('ends on Done with the Answer, and goes 15 s after the later of done and the last sentence spoken (AC4)', () => {
    const fold = createTurnCardFold()
    speak(fold, 'set a timer for five minutes')
    fold.onEvent({ type: 'command', turnId: 't1', text: 'set a timer for five minutes', action: 'timer 5m', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 4600 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Timer set, 5 minutes', at: 5200 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'Timer set, 5 minutes', at: 5200 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 5300 })
    expect(turnLive(fold.state())).toEqual({ kind: 'end', end: 'done', endedAt: 5300 })
    expect(turnStation(fold.state())).toBe(5)
    expect(labels(fold).at(-1)).toBe('Done: Timer set, 5 minutes')
    // The sentence still sounds: no deadline yet.
    expect(fold.state().retiresAt).toBeNull()
    fold.onEvent({ type: 'spoken', turnId: 't1', at: 7000 })
    expect(fold.state().retiresAt).toBe(7000 + PEEK_CARD_LINGER_MS)
    fold.expire(7000 + PEEK_CARD_LINGER_MS - 1)
    expect(fold.state().phase).toBe('open')
    fold.expire(7000 + PEEK_CARD_LINGER_MS)
    expect(fold.state().phase).toBe('hidden')
  })

  it('a sentence spoken before done counts from done; a tap closes the card', () => {
    const fold = createTurnCardFold()
    speak(fold, 'stop')
    fold.onEvent({ type: 'command', turnId: 't1', text: 'stop', action: 'stop', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 4600 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Stopped.', at: 4600 })
    fold.onEvent({ type: 'spoken', turnId: 't1', at: 5000 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'Stopped.', muted: true, at: 5100 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 5100 })
    expect(fold.state().end).toBe('stopped')
    expect(fold.state().retiresAt).toBe(5100 + PEEK_CARD_LINGER_MS)
    fold.dismiss()
    expect(fold.state().phase).toBe('hidden')
  })

  it('a failure ends on Failed, its Answer in the words row, the Read as row kept (AC3)', () => {
    const fold = createTurnCardFold()
    speak(fold, 'turn it up')
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'turn it up', at: 4400 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'turn it up', action: 'volume up', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 5200 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Nothing is playing.', failure: true, at: 5200 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'Nothing is playing.\n\nTry “play jazz”.', failure: true, at: 5200 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'failed', at: 5300 })
    expect(turnLive(fold.state())).toMatchObject({ kind: 'end', end: 'failed' })
    expect(turnWords(fold.state())).toEqual({ text: 'Nothing is playing. Try “play jazz”.', tone: 'fail' })
    expect(labels(fold).slice(-3)).toEqual(['Read as: volume up', 'Speaking: Nothing is playing.', 'Failed: Nothing is playing.'])
    expect(fold.state().steps.at(-1)?.tone).toBe('fail')
  })

  it('a line whose Answer tells a failure ends on Failed though its outcome says done (#329)', () => {
    const fold = createTurnCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'play nothing at all', at: 100 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'play nothing at all', action: 'play nothing at all', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 200 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'No videos found.', failure: true, at: 300 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'No videos found.', failure: true, at: 300 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 400 })
    expect(fold.state().end).toBe('failed')
    expect(labels(fold).at(-1)).toBe('Failed: No videos found.')
  })

  it('a line read as no Command ends on No response, read as none (AC3)', () => {
    const fold = createTurnCardFold()
    speak(fold, 'what a lovely day')
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'what a lovely day', at: 4400 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'what a lovely day', dropped: true, task: { id: 't1', hop: 0 }, at: 6000 })
    fold.onEvent({ type: 'display', turnId: 't1', text: 'No response.\n\nNot a command.', muted: true, at: 6000 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 6000 })
    expect(fold.state().reading).toBe(NO_COMMAND)
    expect(fold.state().end).toBe('dropped')
    expect(labels(fold).slice(-2)).toEqual([`Read as: ${NO_COMMAND}`, 'No response: No response.'])
    expect(fold.state().retiresAt).toBe(6000 + PEEK_CARD_LINGER_MS)
  })

  it('a fast line whose events land before its own `heard` keeps its card: the receipt slots in after the ear rows (AC1)', () => {
    const fold = createTurnCardFold()
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 1000 }), 1000)
    fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 1600 }), 1600)
    fold.onPartial('timer 5 minutes')
    fold.onPartial('')
    fold.onVoice(voice({ transcribing: true, since: 3300 }), 3300)
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 4400 }), 4400)
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'timer 5 minutes', at: 4401 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'timer 5 minutes', action: 'timer 5m', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 4402 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Timer set, 5 minutes', at: 4403 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 4404 })
    fold.onHeard({ text: 'Timer 5 minutes', routed: 'command', at: 4410 })
    expect(fold.state().end).toBe('done')
    expect(fold.state().openedAt).toBe(1000)
    expect(labels(fold)).toEqual(['Listening: “timer 5 minutes…”', 'Transcribing: “timer 5 minutes”', 'Heard: “Timer 5 minutes”', 'Thinking: “timer 5 minutes”', 'Read as: timer 5m', 'Speaking: Timer set, 5 minutes', 'Done: Timer set, 5 minutes'])
    expect(turnLive(fold.state())).toMatchObject({ kind: 'end', end: 'done' })
  })

  it('a `heard` that trails the line\'s first stage is slotted in before it (AC1)', () => {
    const fold = createTurnCardFold()
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 1000 }), 1000)
    fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 1600 }), 1600)
    fold.onPartial('what a lovely')
    fold.onPartial('')
    fold.onVoice(voice({ transcribing: true, since: 3300 }), 3300)
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 4400 }), 4400)
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'what a lovely day', at: 4400 })
    fold.onHeard({ text: 'what a lovely day', routed: 'command', at: 4401 })
    expect(labels(fold)).toEqual(['Listening: “what a lovely…”', 'Transcribing: “what a lovely”', 'Heard: “what a lovely day”', 'Thinking: “what a lovely day”'])
    expect(turnLive(fold.state())).toMatchObject({ kind: 'stage', stage: { status: 'thinking' } })
  })

  it('a typed line after a spoken one that ended is its own card: the old ear rows and clock are not its', () => {
    const fold = createTurnCardFold()
    speak(fold, 'what a lovely day')
    fold.onEvent({ type: 'command', turnId: 't1', text: 'what a lovely day', dropped: true, task: { id: 't1', hop: 0 }, at: 4600 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 4600 })
    fold.onEvent({ type: 'status', turnId: 't2', status: 'thinking', hop: 0, detail: 'timer 5m', at: 9000 })
    fold.onEvent({ type: 'command', turnId: 't2', text: 'timer 5m', action: 'timer 5m', keepsIdle: true, task: { id: 't2', hop: 0 }, at: 9100 })
    expect(labels(fold)).toEqual(['Thinking: “timer 5m”', 'Read as: timer 5m'])
    expect(fold.state().openedAt).toBe(9000)
  })

  it('a typed line opens the card on its first event, with no ear rows', () => {
    const fold = createTurnCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'timer 5m', at: 100 })
    expect(fold.state().phase).toBe('open')
    expect(fold.state().openedAt).toBe(100)
    fold.onEvent({ type: 'command', turnId: 't1', text: 'timer 5m', action: 'timer 5m', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 110 })
    expect(labels(fold)).toEqual(['Thinking: “timer 5m”', 'Read as: timer 5m'])
    expect(turnStation(fold.state())).toBe(1)
  })

  it('speech starting after a line has ended restarts the card as the next line (AC4)', () => {
    const fold = createTurnCardFold()
    speak(fold, 'stop')
    fold.onEvent({ type: 'command', turnId: 't1', text: 'stop', action: 'stop', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 4600 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 4700 })
    // The Hot Listen's open ear after the end: the end leads, the ear says nothing until speech.
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 4800 }), 4800)
    expect(turnLive(fold.state())).toMatchObject({ kind: 'end' })
    fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 9000 }), 9000)
    expect(fold.state().phase).toBe('open')
    expect(fold.state().openedAt).toBe(9000)
    expect(fold.state().end).toBeNull()
    expect(labels(fold)).toEqual(['Listening: …'])
    // The line's events from before are not this card's.
    fold.onEvent({ type: 'spoken', turnId: 't1', at: 9100 })
    expect(fold.state().retiresAt).toBeNull()
  })

  it('a new line over a running one keeps its ear rows through the restart its `command` makes', () => {
    const fold = createTurnCardFold()
    speak(fold, 'read')
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'read', at: 4400 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'read', action: 'read', task: { id: 't1', hop: 0 }, at: 4500 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'speaking', hop: 0, at: 4600 })
    // Speech in the Hot Listen while the read runs: the receipt first, on the same card.
    fold.onVoice(voice({ listening: true, reason: 'wake', hearing: true, since: 8000 }), 8000)
    fold.onPartial('stop')
    expect(turnLive(fold.state())).toEqual({ kind: 'ear', phase: 'hearing', since: 8000 })
    expect(labels(fold).at(-1)).toBe('Listening: “stop…”')
    fold.onPartial('')
    fold.onVoice(voice({ transcribing: true, since: 8600 }), 8600)
    fold.onHeard({ text: 'stop', routed: 'abort', at: 9000 })
    fold.onVoice(voice({ since: 9000 }), 9000)
    // The read is cancelled, then the Stop's own Command.
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'cancelled', at: 9010 })
    fold.onEvent({ type: 'status', turnId: 't2', status: 'thinking', hop: 0, detail: 'stop', at: 9020 })
    fold.onEvent({ type: 'command', turnId: 't2', text: 'stop', action: 'stop', keepsIdle: true, task: { id: 't2', hop: 0 }, at: 9100 })
    expect(fold.state().turnId).toBe('t2')
    expect(labels(fold)).toEqual(['Listening: “stop…”', 'Transcribing: “stop”', 'Heard: “stop”', 'Thinking: “stop”', 'Read as: stop'])
    fold.onEvent({ type: 'display', turnId: 't2', text: 'Stopped.', muted: true, at: 9200 })
    fold.onEvent({ type: 'done', turnId: 't2', outcome: 'done', at: 9200 })
    expect(fold.state().end).toBe('stopped')
    expect(labels(fold).at(-1)).toBe('Stopped: Stopped.')
  })

  it('a hop past the first continues the card and takes its forerunner\'s end row with it', () => {
    const fold = createTurnCardFold()
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'open the news', at: 100 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'open the news', action: 'navigate news.example', task: { id: 't1', hop: 0 }, at: 200 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Opening', detail: 'news.example', at: 200 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 900 })
    expect(fold.state().end).toBe('done')
    fold.onEvent({ type: 'status', turnId: 't2', status: 'thinking', hop: 1, detail: 'open the news', at: 910 })
    expect(fold.state().end).toBeNull()
    expect(fold.state().retiresAt).toBeNull()
    fold.onEvent({ type: 'command', turnId: 't2', text: 'open the news', action: 'click 3', task: { id: 't1', hop: 1 }, at: 1200 })
    expect(fold.state().turnId).toBe('t1')
    expect(labels(fold)).toEqual(['Thinking: “open the news”', 'Read as: navigate news.example', 'Opening: news.example', 'Thinking: “open the news”', 'Read as: click 3'])
    fold.onEvent({ type: 'done', turnId: 't2', outcome: 'done', at: 2000 })
    expect(fold.state().retiresAt).toBe(2000 + PEEK_CARD_LINGER_MS)
  })

  it('the history is six rows, oldest first, the rest blank', () => {
    const fold = createTurnCardFold()
    speak(fold, 'turn it up')
    expect(turnHistory(fold.state()).map((step) => step?.label ?? null)).toEqual(['Listening', 'Transcribing', 'Heard', null, null, null])
    fold.onEvent({ type: 'status', turnId: 't1', status: 'thinking', hop: 0, detail: 'turn it up', at: 4400 })
    fold.onEvent({ type: 'command', turnId: 't1', text: 'turn it up', action: 'volume up', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 5200 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'acting', hop: 0, word: 'Turning up', detail: 'the volume', at: 5200 })
    fold.onEvent({ type: 'speak', turnId: 't1', text: 'Volume 60 percent', at: 5300 })
    fold.onEvent({ type: 'done', turnId: 't1', outcome: 'done', at: 5400 })
    expect(turnHistory(fold.state()).map((step) => step?.label)).toEqual(['Heard', 'Thinking', 'Read as', 'Turning up', 'Speaking', 'Done'])
  })

  it('while the line\'s own Speaking stage runs the open ear is at rest; a line heard outside a wake ends on No response', () => {
    const fold = createTurnCardFold()
    speak(fold, 'read')
    fold.onEvent({ type: 'command', turnId: 't1', text: 'read', action: 'read', task: { id: 't1', hop: 0 }, at: 4500 })
    fold.onEvent({ type: 'status', turnId: 't1', status: 'speaking', hop: 0, at: 4600 })
    fold.onVoice(voice({ listening: true, reason: 'wake', since: 4700 }), 4700)
    expect(fold.state().ear).toBe('rest')
    expect(turnLive(fold.state())).toMatchObject({ kind: 'stage', stage: { status: 'speaking' } })

    const other = createTurnCardFold()
    other.onVoice(voice({ listening: true, reason: 'hotkey', since: 100 }), 100)
    other.onHeard({ text: 'yes', routed: 'ignored', at: 900 })
    expect(other.state().end).toBe('dropped')
    expect(other.state().retiresAt).toBe(900 + PEEK_CARD_LINGER_MS)
  })
})
