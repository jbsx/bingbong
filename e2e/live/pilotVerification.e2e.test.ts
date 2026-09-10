import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantTurn } from '../../src/core/ports/llm'
import { startFixtureServer, type FixtureServer } from '../fixtureServer'
import { LIVE_ARTIFACTS_ROOT, readCaptureSet, validateCaptureSet, writeCaptureSet } from './artifacts.ts'
import { startCaptureSession, type CaptureSessionOptions } from './capture.ts'
import { liveWebHunts } from './hunts.ts'
import { captureSetOf, createHuntCaptureHost, plannedSlots, type HuntAttempt, type StartCaptureSession } from './pass.ts'
import { runLiveWebPass, type PassRecord } from './schedule.ts'

// THE NO-SPEND REHEARSAL OF THE PAID PILOT (#227, acceptance criterion 1).
//
// `pilot.live.test.ts` is the paid entry point and cannot be run to find out
// whether the path works — running it *is* the spend. This runs the same
// schedule, through the same host, against a scripted model and local fixture
// pages, and writes the same artifacts to the same root. What comes out is a
// real `LiveCaptureSet` produced by a real pass, which the offline grading and
// reporting commands then consume exactly as they will consume the pilot's.
//
// WHY THE SET IS LEFT ON DISK. The rest of the path — `pnpm live:keys`,
// `pnpm live:report init-grades`, the reviewer's edit, `pnpm live:report` — is
// offline and belongs outside a test. This writes the input those commands
// need under the gitignored artifacts root and leaves it there, so the
// capture-to-report path can be verified end to end with the actual CLI
// rather than by calling its internals in process.
//
// NO KEY IS LOADED HERE. This file launches the app, so it is held to the
// capture path's rule even though its model is scripted: grading is offline,
// and a module that launches Electron has no business being able to read an
// answer. `corpus.test.ts` enforces the general form of this.
//
// THE POPULATION IS DELIBERATELY MIXED. A path that only ever carries clean
// successes proves very little. The first hunt resets its own Session
// mid-Run, so its follow-up is genuinely not reached and the report has to
// show a slot nothing was dispatched into — the row #227 forbids dropping.

const answer = (display: string, speak = 'Done.'): AssistantTurn => ({ kind: 'answer', speak, display })

/**
 * The set id the offline commands are then run against. Fresh per run, because
 * a capture identity is claimed and never reused — a stable id makes the
 * second rehearsal fail on the first one's leftovers rather than repeating it.
 * `afterAll` prints the path the grading commands take.
 */
export const VERIFICATION_SET_ID =
  process.env.BINGBONG_LIVE_SET_ID ?? `verification-${new Date().toISOString().replace(/[:.]/g, '-')}`

describe('the capture-to-report path, rehearsed without spending (#227)', () => {
  let fixture: FixtureServer
  let pass: PassRecord<HuntAttempt> | null = null
  let setPath: string | null = null
  const CORPUS = liveWebHunts()
  const [PI] = CORPUS

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
    if (setPath) console.log(`\nverification set: ${setPath}`)
  })

  function scriptedStart(scripts: Record<string, AssistantTurn[]>): StartCaptureSession {
    return async (options: CaptureSessionOptions) =>
      startCaptureSession({
        ...options,
        verification: {
          env: { BINGBONG_LLM_SCRIPT: JSON.stringify(scripts[options.huntId] ?? [answer('UNSCRIPTED')]) },
          fixture,
        },
      })
  }

  it(
    'produces a gradeable set from a real pass, including a slot nothing reached',
    async () => {
      const start = scriptedStart({
        // Hunt 1 asks for a fresh Session mid-Run. The initial is answered in
        // the replacement Session, which the schedule refuses to ride, so the
        // follow-up is not reached — a real not-reached row rather than a
        // hand-written one.
        [PI.id]: [
          { kind: 'tool_calls', calls: [{ id: 'reset', name: 'new_session', args: {} }] },
          answer('A VERIFICATION ANSWER, GRADED AGAINST NOTHING'),
          answer('THIS FOLLOW-UP MUST NEVER RUN'),
        ],
      })

      const host = createHuntCaptureHost(start, { mode: 'verification', setId: VERIFICATION_SET_ID })
      pass = await runLiveWebPass(host)

      const set = captureSetOf(pass, { setId: VERIFICATION_SET_ID, mode: 'verification', sessions: host.sessions })
      setPath = writeCaptureSet(join(LIVE_ARTIFACTS_ROOT, `${VERIFICATION_SET_ID}.json`), set)

      // --- the same measurement invariants the paid pass asserts ---

      expect(set.slots).toHaveLength(plannedSlots().length)
      expect(set.mode).toBe('verification')
      const validation = validateCaptureSet(JSON.parse(JSON.stringify(set)))
      expect(validation.ok ? [] : validation.errors).toEqual([])
      expect(pass.commandBudget).toBe(6)
      expect(pass.commandsSubmitted).toBeLessThanOrEqual(pass.commandBudget)
      expect(pass.hunts.map((hunt) => hunt.huntId)).toEqual(CORPUS.map((hunt) => hunt.id))
      expect(set.state, set.stateReason).toBe('complete')

      // --- the mixed population the offline commands then have to report ---

      // Five commands, not six: the first hunt's follow-up was refused, and
      // nothing was retried or restarted to make it possible.
      expect(pass.commandsSubmitted).toBe(5)
      const piFollowUp = pass.hunts[0]!.followUp!
      expect(piFollowUp.status).toBe('not-reached')
      if (piFollowUp.status !== 'not-reached') throw new Error('unreachable')
      expect(piFollowUp.reason).toBe('session_lost')

      // The plan still describes six slots, so the not-reached one is a
      // visible row downstream rather than a shorter set.
      expect(set.slots).toHaveLength(6)

      // --- and it survives the round trip the offline commands make ---

      const reread = readCaptureSet(setPath)
      expect(reread.ok ? [] : reread.errors).toEqual([])
      if (!reread.ok) throw new Error('unreachable')
      expect(reread.value.set.slots).toHaveLength(6)
      // Every session the set names resolves to a readable capture; a set
      // whose evidence cannot be reopened is not gradeable, whatever it says.
      expect(reread.value.sessions.filter((session) => !session.ok)).toEqual([])
    },
    30 * 60_000,
  )
})
