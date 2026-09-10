import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LIVE_ARTIFACTS_ROOT, validateCaptureSet, writeCaptureSet } from './artifacts.ts'
import { startCaptureSession } from './capture.ts'
import { liveWebHunts } from './hunts.ts'
import { captureSetOf, createHuntCaptureHost, plannedSlots, type HuntAttempt } from './pass.ts'
import { runLiveWebPass, type PassRecord } from './schedule.ts'

// THE PAID ENTRY POINT (#225). One bounded pilot pass: the four accepted
// hunts against the live web, each from a fresh Session on a restored
// benchmark profile, with the two fixed follow-ups. Four initial submissions
// plus at most two follow-ups — six commands, once each.
//
// IT NEVER RUNS BY ACCIDENT. `*.live.test.ts` is matched by no config but
// vitest.live.config.ts, is excluded from the unit suite explicitly (asserted
// in config.test.ts, because the cost of that exclusion being wrong is real
// money), and rides no CI. Run it deliberately:
//
//     pnpm test:live
//
// A SET ID IS CLAIMED ONCE. The capture directory refuses an identity that
// already exists, which is what stops a re-run overwriting evidence that was
// already captured — and on a paid path that refusal surfaces late, as a
// `measurement_failed` set rather than as an obvious error. So the default id
// is timestamped and a pass never collides with itself. Set
// BINGBONG_LIVE_SET_ID only to name a pass deliberately, and give each pass
// its own value; re-running a failed pass under the id it already used is the
// one way to make a fresh attempt look like broken measurement.
//
// ONE PASS PER INVOCATION. There is no loop and no repeat flag. Three
// baseline passes need separate post-pilot authorization (#223), and a
// campaign that could be started by passing a number is exactly what that
// authorization is meant to gate.
//
// WHAT FAILS THE SUITE. Broken measurement only — the same rule the release
// evaluator follows. A hunt the assistant gets wrong is the finding this
// study exists to record, not a red test; grading happens offline against
// keys this file cannot see. So the assertions below check that the pass was
// *measured*, never that it went well.

describe('live-web pilot pass (#225)', () => {
  const setId = process.env.BINGBONG_LIVE_SET_ID ?? `pilot-${new Date().toISOString().replace(/[:.]/g, '-')}`
  let pass: PassRecord<HuntAttempt> | null = null
  let setPath: string | null = null

  afterAll(() => {
    if (!pass) return
    // Print the pass as a table the developer reads before grading: what was
    // attempted, what was not reached and why. Timings and usage live in the
    // capture files; this is the map of the population.
    for (const hunt of pass.hunts) {
      const initial = hunt.initial.status === 'attempted' ? 'attempted' : `not reached (${hunt.initial.reason})`
      const followUp =
        hunt.followUp === null
          ? 'none'
          : hunt.followUp.status === 'attempted'
            ? 'attempted'
            : `not reached (${hunt.followUp.reason})`
      console.log(`${hunt.huntId}\n  initial:   ${initial}\n  follow-up: ${followUp}`)
    }
    console.log(`\n${pass.commandsSubmitted}/${pass.commandBudget} commands submitted`)
    if (setPath) console.log(`set file: ${setPath}`)
  })

  it(
    'captures one bounded pass over the approved corpus',
    async () => {
      const host = createHuntCaptureHost(startCaptureSession, {
        mode: 'measured',
        setId,
        // Measured mode composes production routing itself and fails fast
        // without an orchestrator, refuses every scripted hook, and unsets
        // the test-only timing overrides. Nothing here may relax that.
        //
        // The capture's own startup budget is left alone deliberately. This
        // once carried a three-minute override, added while a measured launch
        // was failing to come up and the real ad-block lists were the
        // suspect. The cause turned out to be a target-discovery race in the
        // harness (#227), which no budget could have fixed — 420 s failed
        // exactly as 120 s did — and the lists cost a second or two to parse.
        // A guard rail sized against a cause that does not exist is just a
        // number nobody can justify, so it is gone.
      })

      pass = await runLiveWebPass(host)

      // The set file sits beside the capture directories it names, because a
      // session reference is relative to the set file's own directory.
      const set = captureSetOf(pass, { setId, mode: 'measured', sessions: host.sessions })
      setPath = writeCaptureSet(join(LIVE_ARTIFACTS_ROOT, `${setId}.json`), set)

      // --- measurement invariants only, from here down ---

      // The whole planned population is described, whatever happened to it.
      expect(set.slots).toHaveLength(plannedSlots().length)
      expect(set.mode).toBe('measured')
      const validation = validateCaptureSet(JSON.parse(JSON.stringify(set)))
      expect(validation.ok ? [] : validation.errors).toEqual([])

      // The work bound held. This is the assertion that protects the wallet.
      expect(pass.commandsSubmitted).toBeLessThanOrEqual(pass.commandBudget)
      expect(pass.commandBudget).toBe(6)

      // Every hunt in the corpus produced a record — attempted or explicitly
      // not reached. A silently dropped hunt is broken measurement.
      expect(pass.hunts.map((hunt) => hunt.huntId)).toEqual(liveWebHunts().map((hunt) => hunt.id))

      // A pass that could not observe its own commands is a broken
      // measurement and must be addressed, not graded. Hunts that merely
      // failed leave the state `complete`.
      expect(set.state, set.stateReason).toBe('complete')
    },
    // Four hunts of live browsing, sequentially, at production effort limits.
    3 * 60 * 60_000,
  )
})
