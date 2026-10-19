import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandLogRecord } from '../../core/command/decisionRecord'
import type { AskRecord } from '../../core/decision/askRecord'
import type { DecisionAnswer, DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../../core/ports/decisionModel'
import { FakeBrowser, FakeClock, FakeVad, RecordingTts, fakePerfHarness, flushMicrotasks } from '../../core/testing/doubles'
import { createVoiceSession } from '../../core/voice/voiceSession'
import { vadDefaults } from '../../core/voice/vadEndpointing'
import { createScriptedTranscriber } from '../voice/createScriptedTranscriber'
import { createCommandRunner, type CommandRunner } from './commandRunner'

// Early Fire through the voice seam (#326, AC1): a scripted transcriber
// streams partials while the Utterance is spoken, the session hands each
// to the runner as main's attachVoice does, and the runner fires the
// Command before the Endpoint. The Endpoint then makes no second Command.

class CountingDecisionModel implements DecisionModel {
  readonly model = 'jev-1.14.0'
  readonly requests: DecisionRequest<DecisionQuestions>[] = []

  async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    this.requests.push(request as DecisionRequest<DecisionQuestions>)
    return { status: 'unavailable', reason: 'failed', message: 'scripted', latencyMs: 1, model: this.model }
  }
}

/** A Decision Model that answers a script in order, like the stand-in main serves. */
class ScriptedDecisionModel implements DecisionModel {
  readonly model = 'jev-1.14.0'
  readonly requests: DecisionRequest<DecisionQuestions>[] = []
  constructor(private readonly script: Record<string, DecisionAnswer>[]) {}

  async ask<const Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    this.requests.push(request as DecisionRequest<DecisionQuestions>)
    const answers = this.script.shift()
    if (answers === undefined) return { status: 'unavailable', reason: 'failed', message: 'scripted', latencyMs: 1, model: this.model }
    // A hop asked a Verdict the script does not answer gets a sure one: yes after `done`, else not yet.
    const verb = answers.verb
    const verdict = 'outcome' in request.questions && !('outcome' in answers) ? { outcome: choice(verb?.type === 'choice' && verb.choice === 'done' ? 'yes' : 'not_yet') } : {}
    return { status: 'answered', answers: { ...answers, ...verdict } as never, latencyMs: 1, model: this.model }
  }
}

const choice = (label: string): DecisionAnswer => ({ type: 'choice', choice: label, confidence: 0.9, probabilities: { [label]: 0.9 } })

/** One spoken Utterance through a voice session wired as main's attachVoice wires it, a frame a millisecond. */
async function speak(runner: CommandRunner, transcript: { text: string; partials: string[] }, perf: ReturnType<typeof fakePerfHarness>): Promise<void> {
  const vad = new FakeVad()
  const session = createVoiceSession({
    vad,
    transcriber: createScriptedTranscriber(JSON.stringify([transcript])),
    clock: new FakeClock(),
    tts: new RecordingTts(),
    tracer: perf.tracer,
    onSubmitCommand: (text, submitted) => void runner.run(text, { ...submitted, source: 'spoken' }),
    onSpeechStart: () => void runner.prepare(),
    onPartial: (text) => {
      if (text !== '') void runner.consider(text)
    },
    getRunState: () => runner.getState(),
    onAbort: () => runner.abort(),
    onStateChange: () => {},
    onHeard: () => {},
    onError: () => {},
  })
  session.arm()
  const frames = [...Array.from({ length: 12 }, () => 0.95), ...Array.from({ length: vadDefaults().endFrames + 2 }, () => 0.01)]
  for (const [i, prob] of frames.entries()) {
    perf.state.monotonicMs = i
    vad.queue.push(prob)
    await session.pushAudio(new Float32Array(512))
    await flushMicrotasks()
  }
  await flushMicrotasks()
}

describe('a Task whose hop 0 Early Fired (#328, AC6)', () => {
  function wired(script: Record<string, DecisionAnswer>[]) {
    const browser = new FakeBrowser()
    const records: CommandLogRecord[] = []
    const asks: AskRecord[] = []
    const perf = fakePerfHarness()
    const decision = new ScriptedDecisionModel(script)
    const runner = createCommandRunner({
      browser,
      decisionModel: () => decision,
      publish: () => {},
      now: () => 1_700_000_000_000,
      tracer: perf.tracer,
      decisionLog: { write: (record) => records.push(record) },
      askLog: { write: (record) => asks.push(record) },
      screenshotDir: () => '/shots',
      saveScreenshot: async () => {},
    })
    return { browser, records, asks, perf, decision, runner }
  }

  it('writes each partial\'s ask under its own id, and the Early Fire\'s record names the partial it fired on (#338)', async () => {
    const { records, asks, decision, perf, runner } = wired([
      { verb: choice('search'), target: choice('none'), slot: choice('s2-3'), complete: { type: 'noul', noul: 0.9 } },
      { verb: choice('done'), target: choice('none'), slot: choice('none') },
    ])
    await speak(runner, { text: 'Pull up some lofi music.', partials: ['pull up some lofi'] }, perf)

    expect(asks.map((ask) => ask.kind)).toEqual(['partial', 'hop'])
    expect(asks[0]).not.toHaveProperty('turnId')
    expect(asks[0]!.questions).toEqual(decision.requests[0]!.questions)
    expect(Object.keys(asks[0]!.questions)).toContain('complete')
    expect(decisions(records).map((record) => record.ask)).toEqual(asks.map((ask) => ask.id))
    expect(decisions(records)[0]!.partialAsks).toEqual([asks[0]!.id])
  })

  it('names the ask of a partial that fired nothing on the record its Endpoint writes (#338)', async () => {
    const { records, asks, perf, runner } = wired([
      { verb: choice('search'), target: choice('none'), slot: choice('s2-3'), complete: { type: 'noul', noul: 0.2 } },
      { verb: choice('none'), target: choice('none'), slot: choice('none') },
    ])
    await speak(runner, { text: 'Pull up some lofi music.', partials: ['pull up some lofi'] }, perf)

    expect(asks.map((ask) => ask.kind)).toEqual(['partial', 'command'])
    expect(decisions(records)).toEqual([expect.objectContaining({ ask: asks[1]!.id, partialCalls: 1, partialAsks: [asks[0]!.id] })])
  })
  const decisions = (records: CommandLogRecord[]) => records.flatMap((record) => (record.type === 'decision' ? [record] : []))

  it('goes on only after the Endpoint, and hop 1 reads the final transcript', async () => {
    const { browser, records, perf, decision, runner } = wired([
      { verb: choice('search'), target: choice('none'), slot: choice('s2-3'), complete: { type: 'noul', noul: 0.9 } },
      { verb: choice('done'), target: choice('none'), slot: choice('none') },
    ])
    await speak(runner, { text: 'Pull up some lofi music.', partials: ['pull up some lofi'] }, perf)

    expect(browser.navigations).toEqual(['https://duckduckgo.com/?q=some%20lofi'])
    expect(decision.requests).toHaveLength(2)
    expect(decision.requests[1]!.state).toContain('"Pull up some lofi music."')
    expect(decisions(records)).toEqual([
      expect.objectContaining({ verb: 'search', earlyFire: expect.objectContaining({ partial: 'pull up some lofi' }), task: expect.objectContaining({ hop: 0 }) }),
      expect.objectContaining({ verb: 'done', transcript: 'Pull up some lofi music.', ended: 'done', task: expect.objectContaining({ hop: 1 }) }),
    ])
    expect(decisions(records)[0]!.ended).toBeUndefined()
  })

  it('ends after hop 0 when its partials are let go before an Endpoint', async () => {
    const { browser, records, decision, runner } = wired([{ verb: choice('search'), target: choice('none'), slot: choice('s2-3'), complete: { type: 'noul', noul: 0.9 } }])
    void runner.prepare()
    await runner.consider('pull up some lofi')
    expect(browser.navigations).toHaveLength(1)
    runner.dropPartials()
    // The next Utterance's speech start records it, with no Endpoint, and no hop is read.
    void runner.prepare()
    await flushMicrotasks()
    expect(decision.requests).toHaveLength(1)
    expect(decisions(records)).toEqual([expect.objectContaining({ verb: 'search', ended: 'superseded', earlyFire: { partial: 'pull up some lofi', noul: 0.9 } })])
  })
})

describe('Early Fire through the voice session', () => {
  it('fires "scroll down" from a partial before the Endpoint with no Jev call, and the Endpoint makes no second Command', async () => {
    const browser = new FakeBrowser()
    const events: PipelineEvent[] = []
    const records: CommandLogRecord[] = []
    const perf = fakePerfHarness()
    const decision = new CountingDecisionModel()
    const runner = createCommandRunner({
      browser,
      decisionModel: () => decision,
      publish: (event) => events.push(event),
      now: () => 1_700_000_000_000,
      tracer: perf.tracer,
      decisionLog: { write: (record) => records.push(record) },
      screenshotDir: () => '/shots',
      saveScreenshot: async () => {},
    })
    const vad = new FakeVad()
    const transcriber = createScriptedTranscriber(JSON.stringify([{ text: 'Scroll down.', partials: ['scroll', 'scroll down'] }]))
    const session = createVoiceSession({
      vad,
      transcriber,
      clock: new FakeClock(),
      tts: new RecordingTts(),
      tracer: perf.tracer,
      onSubmitCommand: (text, submitted) => void runner.run(text, { ...submitted, source: 'spoken' }),
      onSpeechStart: () => void runner.prepare(),
      onPartial: (text) => {
        if (text !== '') void runner.consider(text)
      },
      getRunState: () => runner.getState(),
      onAbort: () => runner.abort(),
      onStateChange: () => {},
      onHeard: () => {},
      onError: () => {},
    })
    session.arm()

    // Speech, one frame a millisecond: the partials stream while it lasts.
    let scrolledAt: number | null = null
    const frames = [...Array.from({ length: 12 }, () => 0.95), ...Array.from({ length: vadDefaults().endFrames + 2 }, () => 0.01)]
    for (const [i, prob] of frames.entries()) {
      perf.state.monotonicMs = i
      vad.queue.push(prob)
      await session.pushAudio(new Float32Array(512))
      await flushMicrotasks()
      if (scrolledAt === null && browser.scrolls.length > 0) scrolledAt = i
    }
    await flushMicrotasks()

    expect(browser.scrolls).toEqual(['down'])
    expect(decision.requests).toEqual([])
    expect(events.filter((event) => event.type === 'command')).toHaveLength(1)
    const decisions = records.filter((record) => record.type === 'decision')
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ verb: 'scroll_down', transcript: 'Scroll down.', earlyFire: { partial: 'scroll down' } })
    const lead = decisions[0]!.type === 'decision' ? decisions[0]!.earlyFire?.leadMs : undefined
    expect(lead).toBeGreaterThan(0)
    // It fired while the user was still speaking.
    expect(scrolledAt).not.toBeNull()
    expect(scrolledAt!).toBeLessThan(12)
  })
})
