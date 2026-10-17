import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import type { CommandLogRecord } from '../../core/command/decisionRecord'
import type { DecisionModel, DecisionQuestions, DecisionRequest, DecisionResult } from '../../core/ports/decisionModel'
import { FakeBrowser, FakeClock, FakeVad, RecordingTts, fakePerfHarness, flushMicrotasks } from '../../core/testing/doubles'
import { createVoiceSession } from '../../core/voice/voiceSession'
import { vadDefaults } from '../../core/voice/vadEndpointing'
import { createScriptedTranscriber } from '../voice/createScriptedTranscriber'
import { createCommandRunner } from './commandRunner'

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
