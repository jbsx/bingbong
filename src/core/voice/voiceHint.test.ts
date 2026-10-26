import { describe, expect, it } from 'vitest'
import { EAR_FAILED_LINE, REST_HINT, voiceHint } from './voiceHint'

// The Status Capsule's voice hint (#331; the rule is in voiceHint.ts).

const quiet = { transcribing: false, listening: false, hearing: false, monitoring: false, partial: '' }

describe('voiceHint', () => {
  it('carries the words being read and the seconds since the Endpoint while transcribing — the pill says Transcribing… (#442)', () => {
    expect(voiceHint({ ...quiet, transcribing: true, listening: true, partial: 'next song', since: 1_000 }, { now: 3_500 })).toEqual({ kind: 'transcribing', text: '“next song” · 2s' })
  })

  it('says a line held behind the transcriber’s load is the ear still starting, with its words and seconds (#442)', () => {
    expect(voiceHint({ ...quiet, transcribing: true, loading: 'words', since: 1_000 }, { now: 1_000 })).toEqual({ kind: 'starting', text: 'your words · 0s' })
  })

  it('says the ear is loading, with its seconds, while it cannot hear yet — never the wake word (#442)', () => {
    expect(voiceHint({ ...quiet, monitoring: true, loading: 'ear', since: 1_000 }, { now: 4_000 })).toEqual({ kind: 'starting', text: 'loading the ear · 3s' })
  })

  it('ends the wait with what did not start and what to do, and no count, once a load fails (#447)', () => {
    expect(EAR_FAILED_LINE).toBe('Ear did not start — type, or restart')
    expect(voiceHint({ ...quiet, monitoring: true, loading: 'failed', since: 1_000 }, { now: 9_000 })).toEqual({ kind: 'failed', text: 'type, or restart' })
    expect(voiceHint({ ...quiet, monitoring: true, loading: 'failed' }, { promptShown: true })).toBeNull()
  })

  it('leaves the waits to the Voice Prompt while it is on screen', () => {
    expect(voiceHint({ ...quiet, transcribing: true }, { promptShown: true })).toBeNull()
    expect(voiceHint({ ...quiet, monitoring: true, loading: 'ear' }, { promptShown: true })).toBeNull()
  })

  it('asks for a command while listening, without saying listening again', () => {
    expect(voiceHint({ ...quiet, listening: true })).toEqual({ kind: 'listening', text: 'say a command' })
  })

  it('never asks for a command while the app speaks into the Hot Listen: the rest hint, or the last result (#472)', () => {
    expect(voiceHint({ ...quiet, listening: true, monitoring: true, speaking: true })).toEqual({ kind: 'monitoring', text: REST_HINT })
    expect(voiceHint({ ...quiet, listening: true, monitoring: true, speaking: true }, { result: 'Volume 38 percent' })).toEqual({ kind: 'result', text: 'Volume 38 percent' })
  })

  it('says "…" once speech has started, until the first partial lands (#441)', () => {
    expect(voiceHint({ ...quiet, listening: true, hearing: true })).toEqual({ kind: 'listening', text: '…' })
    expect(voiceHint({ ...quiet, listening: true, hearing: true, partial: 'next' })).toEqual({ kind: 'listening', text: '“next…”' })
  })

  it('shows the live partial transcript while the user speaks', () => {
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' })).toEqual({ kind: 'listening', text: '“open you…”' })
  })

  it('says the one rest hint while only the wake word listens — the Idle Screen, the Prompt and the Feed say it too (#437)', () => {
    expect(REST_HINT).toBe('Say “Bing Bong” or start typing')
    expect(voiceHint({ ...quiet, monitoring: true })).toEqual({ kind: 'monitoring', text: REST_HINT })
  })

  it('is empty with the mic closed', () => {
    expect(voiceHint(quiet)).toBeNull()
  })

  it('keeps the last spoken result in place of the wake instruction (#436)', () => {
    expect(voiceHint({ ...quiet, monitoring: true }, { result: 'Volume 38 percent.' })).toEqual({ kind: 'result', text: 'Volume 38 percent.' })
    expect(voiceHint(quiet, { result: 'Volume 38 percent.' })).toEqual({ kind: 'result', text: 'Volume 38 percent.' })
  })

  it('gives the live words the slot over the last result — they are the next input (#436)', () => {
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' }, { result: 'Volume 38 percent.' })).toEqual({ kind: 'listening', text: '“open you…”' })
  })

  it('says nothing while the Voice Prompt is on screen — the Prompt carries the words (#359)', () => {
    expect(voiceHint(quiet, { promptShown: true, result: 'Volume 38 percent.' })).toBeNull()
    expect(voiceHint({ ...quiet, listening: true, partial: 'open you' }, { promptShown: true })).toBeNull()
    expect(voiceHint({ ...quiet, monitoring: true }, { promptShown: true })).toBeNull()
  })
})
