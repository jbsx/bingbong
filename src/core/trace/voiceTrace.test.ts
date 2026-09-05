import { describe, expect, it } from 'vitest'

// The voice records' shapes (#186). The pipeline writes them through the
// Host Trace writer, so the record's own fields are what these pin — the
// cut, and which bias phrases a transcript is honestly said to contain.

import { createHostTraceWriter, HOST_TRACE_VERSION, type HostTraceRecord } from './hostTrace'
import { biasHits, tracedText, TRACE_SPOKEN_LINE_MAX_CHARS, TRACE_TRANSCRIPT_MAX_CHARS, type VoiceTraceEvent } from './voiceTrace'
import type { SessionId } from '../session/sessionIdentity'

const SESSION = 'session-1' as SessionId
const NOW = 1_700_000_000_000

function harness(sessionId: SessionId | null = SESSION) {
  const records: HostTraceRecord[] = []
  const write = createHostTraceWriter({
    sink: { write: (record) => records.push(record) },
    now: () => NOW,
    activeSessionId: () => sessionId,
  })
  return { records, trace: (event: VoiceTraceEvent) => write(() => event) }
}

describe('voice records', () => {
  it('stamps a wake detection with the scores it was judged by', () => {
    const { records, trace } = harness()
    trace({ kind: 'voice_wake', head: 'wake', score: 0.82, threshold: 0.6, gateMax: 0.91, gate: 0.5 })
    expect(records).toEqual([
      { v: HOST_TRACE_VERSION, at: NOW, sessionId: SESSION, kind: 'voice_wake', head: 'wake', score: 0.82, threshold: 0.6, gateMax: 0.91, gate: 0.5 },
    ])
  })

  it('keeps the endpoint durations and whether the utterance was cut at the cap', () => {
    const { records, trace } = harness()
    trace({ kind: 'voice_endpoint', speechMs: 1_800, totalMs: 2_400, truncated: true, reason: 'wake' })
    expect(records[0]).toMatchObject({ kind: 'voice_endpoint', speechMs: 1_800, totalMs: 2_400, truncated: true, reason: 'wake' })
  })

  it('keeps a transcript with its bias hits and the size of the bias set', () => {
    const { records, trace } = harness()
    trace({ kind: 'voice_stt', text: 'open bing bong', chars: 14, durationMs: 320, biasCount: 12, biasHits: ['bing bong'] })
    expect(records[0]).toMatchObject({ kind: 'voice_stt', text: 'open bing bong', biasHits: ['bing bong'], biasCount: 12 })
  })

  it('records Learned Term admissions and removals with their source', () => {
    const { records, trace } = harness()
    trace({ kind: 'learned_term', source: 'proposals', admitted: ['sonarr'], removed: ['sonar'] })
    expect(records[0]).toMatchObject({ kind: 'learned_term', source: 'proposals', admitted: ['sonarr'], removed: ['sonar'] })
  })

  it('records the exact line handed to the synthesizer, with its turn when it had one', () => {
    const { records, trace } = harness()
    trace({ kind: 'tts_line', text: 'The download finished.', chars: 22, turnId: 'turn-3' })
    expect(records[0]).toMatchObject({ kind: 'tts_line', text: 'The download finished.', turnId: 'turn-3' })
  })

  it('records where a barge-in dropped a line', () => {
    const { records, trace } = harness()
    trace({ kind: 'tts_dropped', text: 'Here is what I found', chars: 20, stage: 'queued' })
    expect(records[0]).toMatchObject({ kind: 'tts_dropped', stage: 'queued', text: 'Here is what I found' })
  })

  it('names a null Session when nothing is live — the ear runs outside every Run', () => {
    const { records, trace } = harness(null)
    trace({ kind: 'voice_wake', head: 'abort', score: 0.7, threshold: 0.6, gateMax: 0.8, gate: 0.5 })
    expect(records[0]?.sessionId).toBeNull()
  })
})

describe('tracedText', () => {
  it('cuts a runaway transcript and keeps its true length', () => {
    const text = 'a'.repeat(TRACE_TRANSCRIPT_MAX_CHARS + 10)
    expect(tracedText(text, TRACE_TRANSCRIPT_MAX_CHARS)).toEqual({
      text: 'a'.repeat(TRACE_TRANSCRIPT_MAX_CHARS),
      chars: TRACE_TRANSCRIPT_MAX_CHARS + 10,
    })
  })

  it('leaves a normal spoken line whole', () => {
    expect(tracedText('Done.', TRACE_SPOKEN_LINE_MAX_CHARS)).toEqual({ text: 'Done.', chars: 5 })
  })
})

describe('biasHits', () => {
  it('reports the bias phrases a transcript actually contains', () => {
    expect(biasHits('open sonarr and check radarr', ['sonarr', 'radarr', 'lidarr'])).toEqual(['sonarr', 'radarr'])
  })

  it('matches on word boundaries, so a phrase inside a longer word is not a hit', () => {
    expect(biasHits('I went on a binge', ['bing'])).toEqual([])
  })

  it('matches a multi-word phrase across punctuation the transcript folded', () => {
    expect(biasHits('Hey, Bing-Bong!', ['bing bong'])).toEqual(['bing bong'])
  })

  it('reports each phrase once, however often it occurs', () => {
    expect(biasHits('sonarr sonarr sonarr', ['sonarr', 'Sonarr'])).toEqual(['sonarr'])
  })

  it('is empty with no bias set and never throws on an empty transcript', () => {
    expect(biasHits('', ['sonarr'])).toEqual([])
    expect(biasHits('anything', [])).toEqual([])
  })
})
