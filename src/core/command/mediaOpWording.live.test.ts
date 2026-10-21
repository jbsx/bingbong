import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandQuestions, commandState } from './jevReading'
import type { CommandPage } from './command'
import { createJevDecisionModel } from '../../main/decision/createJevDecisionModel'
import { resolveDecisionRouting } from '../decision/decisionRouting'

// A measurement, not a guard (#372, AC3 and ADR 0080's last consequence):
// the browser's `back` and `forward` lines are lures for "go back a minute"
// and "skip ahead", and a regression on them is a reading to fix in
// wording, measured. Asked for by name, with the Jev key in the env — never
// part of `pnpm test`, whose key would otherwise buy 81 Jev calls:
//   BINGBONG_WORDING_MEASURE=1 TYPESAFE_API_KEY=… pnpm vitest run src/core/command/mediaOpWording.live.test.ts
// WORDING_OUT=<file> writes the table there as well as to the console.

const routing = process.env.BINGBONG_WORDING_MEASURE ? resolveDecisionRouting(process.env) : ({ configured: false } as const)
const TIMES = Number(process.env.WORDING_TIMES ?? 3)

const FACTS = { paused: false, ended: false, currentTime: 7.4, duration: 60, volume: 1, muted: false, loop: false, rate: 1, seekable: { start: 0, end: 60 }, tracks: 1, captions: null, buffering: false, failed: false }
/** The e2e fixture page with the native video (e2e/fixtureServer.ts /native-video), as the collect reads it. */
const FIXTURE: CommandPage = {
  url: 'http://127.0.0.1:4100/native-video',
  title: 'media fixture',
  refs: [
    { ref: 1, kind: 'media', label: 'Kanye West - Highs and Lows', href: null, inputType: null, media: FACTS },
    { ref: 2, kind: 'link', label: 'Second page', href: 'http://127.0.0.1:4100/second', inputType: null },
  ],
}

interface Variant {
  readonly name: string
  readonly forwardOp: (n: number, title: string) => string
  readonly backOp: (n: number, title: string) => string
  readonly back: string
  readonly forward: string
}

const named = (n: number, title: string): string => `[${n}] ${JSON.stringify(title)}`
const VARIANTS: Variant[] = [
  { name: 'current', forwardOp: (n, t) => `skip forward in ${named(n, t)}, the amount Choice saying how far`, backOp: (n, t) => `skip back in ${named(n, t)}, the amount Choice saying how far`, back: 'go back to the previous page', forward: 'go forward' },
  { name: 'B: ops "by a length of time" + history verbs', forwardOp: (n, t) => `go forward in ${named(n, t)} by a length of time, the amount Choice saying how far`, backOp: (n, t) => `go back in ${named(n, t)} by a length of time, the amount Choice saying how far`, back: "go back to the previous web page in the browser's history", forward: "go forward to the next web page in the browser's history" },
  { name: 'C: ops as B, verbs as now', forwardOp: (n, t) => `go forward in ${named(n, t)} by a length of time, the amount Choice saying how far`, backOp: (n, t) => `go back in ${named(n, t)} by a length of time, the amount Choice saying how far`, back: 'go back to the previous page', forward: 'go forward' },
]

const LINES = ['go back a minute', 'skip 10 seconds ahead', 'skip ahead', 'rewind a bit', 'skip back 30 seconds', 'go back to the previous page', 'go forward']

function reword(options: Record<string, string | null>, variant: Variant, refs: readonly { ref: number; label: string }[]): Record<string, string | null> {
  const out = { ...options }
  for (const ref of refs) {
    if (`forward-${ref.ref}` in out) out[`forward-${ref.ref}`] = variant.forwardOp(ref.ref, ref.label)
    if (`back-${ref.ref}` in out) out[`back-${ref.ref}`] = variant.backOp(ref.ref, ref.label)
  }
  out.back = variant.back
  out.forward = variant.forward
  return out
}

describe.skipIf(!routing.configured)('the seek lines against the browser\'s back and forward (measurement)', () => {
  it('prints each wording\'s reading of the seek lines on the fixture page and on the 11:50 YouTube ask', async () => {
    if (!routing.configured) return
    const model = createJevDecisionModel(routing.endpoint, { timeoutMs: 15_000 })
    const corpus = JSON.parse(readFileSync(new URL('../../../fixtures/jev-cases/turn-mvhzu1tp-b.json', import.meta.url), 'utf8')) as { ask: { state: string; questions: Record<string, { options?: Record<string, string | null> }> } }
    const youtubeRefs = [{ ref: 7, label: 'YE - HIGHS AND LOWS - YouTube' }]
    const rows: string[] = []
    for (const variant of VARIANTS) {
      for (const line of LINES) {
        const page = commandState(line, FIXTURE)
        const questions = commandQuestions(line, FIXTURE)
        const fixtureQuestions = { ...questions, action: { ...questions.action, options: reword(questions.action.options, variant, FIXTURE.refs) } }
        const reads: string[] = []
        for (let n = 0; n < TIMES; n += 1) {
          const result = await model.ask({ state: page, questions: fixtureQuestions })
          reads.push(result.status === 'answered' ? `${result.answers.action.choice} ${result.answers.action.confidence.toFixed(2)}` : result.reason)
        }
        rows.push(`${variant.name} | fixture | ${line} | ${reads.join(', ')}`)
      }
      const ytQuestions = { ...corpus.ask.questions, action: { ...corpus.ask.questions.action, options: reword(corpus.ask.questions.action!.options!, variant, youtubeRefs) } }
      for (const line of ['Skip 10 seconds ahead.', 'Go back a minute.']) {
        const state = corpus.ask.state.replace('"Skip 10 seconds ahead."', JSON.stringify(line))
        const reads: string[] = []
        for (let n = 0; n < TIMES; n += 1) {
          const result = await model.ask({ state, questions: ytQuestions as never })
          const answers = result.status === 'answered' ? (result.answers as Record<string, { choice: string; confidence: number }>) : null
          reads.push(answers === null ? 'unavailable' : `${answers.action!.choice} ${answers.action!.confidence.toFixed(2)}`)
        }
        rows.push(`${variant.name} | youtube | ${line} | ${reads.join(', ')}`)
      }
    }
    const table = `variant | page | line | reads ×${TIMES}\n${rows.join('\n')}\n`
    console.log(`\n${table}`)
    if (process.env.WORDING_OUT) writeFileSync(process.env.WORDING_OUT, table)
    expect(rows.length).toBeGreaterThan(0)
  }, 600_000)
})
