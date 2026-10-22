import { describe, expect, it } from 'vitest'
import type { MediaFacts } from '../src/core/browser/snapshot'
import type { CommandPage } from '../src/core/command/command'
import { commandQuestions, commandState, hopQuestions, type HopContext } from '../src/core/command/jevReading'
import { createScriptedDecisionModel } from '../src/main/decision/createDecisionModel'
import { decisionScript, readingOf } from './scriptedJev'

// The e2e suites' scripted Jev answers every question an ask carries
// (2026-10-22 audit): #383 added the Extent to every ask, the script never
// answered it, and every scripted reading came back malformed — which the
// unit suite could not see. These asks carry every optional question a
// page without a pop-up can: a media ref's Amount, a scopable site's
// Where, a line with a step boundary's Steps.

const FACTS: MediaFacts = { paused: false, ended: false, currentTime: 16.2, duration: 111, volume: 1, muted: false, loop: false, rate: 1, seekable: { start: 0, end: 111 }, tracks: 0, captions: null, hiddenTrack: false, buffering: false, failed: false }
const WATCH: CommandPage = {
  url: 'https://www.youtube.com/watch?v=fixture',
  title: 'Fixture Song - YouTube',
  refs: [{ ref: 7, kind: 'media', label: 'Fixture Song', href: null, inputType: null, media: FACTS }],
}
const LINE = 'play fixture song and loop it'
const HOP: HopContext = { hop: 1, visited: [WATCH.url], actions: [], links: [] }

describe('the scripted Jev', () => {
  it('answers every question a first ask carries', async () => {
    const questions = commandQuestions(LINE, WATCH)
    expect(Object.keys(questions)).toEqual(expect.arrayContaining(['action', 'slot', 'extent', 'amount', 'where', 'steps']))
    const model = createScriptedDecisionModel(decisionScript(readingOf(LINE, 'play-7')).BINGBONG_DECISION_SCRIPT)
    const result = await model.ask({ state: commandState(LINE, WATCH), questions })
    expect(result.status).toBe('answered')
  })

  it("answers every question a hop's ask carries", async () => {
    const questions = hopQuestions(LINE, WATCH, HOP)
    const model = createScriptedDecisionModel(decisionScript(readingOf(LINE, 'none', { outcome: 'yes', progress: 0.9 })).BINGBONG_DECISION_SCRIPT)
    const result = await model.ask({ state: commandState(LINE, WATCH, HOP), questions })
    expect(result.status).toBe('answered')
  })
})
