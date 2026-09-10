import { afterEach, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from '../harness'
import { composeMeasuredLaunch, gitProvenance, type EnvFileInput } from './launch.ts'
import { createBenchmarkProfile, type BenchmarkProfile } from './profile.ts'

// THE MEASURED LAUNCH COMES UP (#227).
//
// This exists because of a category, not an incident. A mode that needs real
// credentials is untestable by construction: every Electron suite #224 and
// #225 wrote runs in verification mode, because that is the only mode that
// works without routing. So `productionDefaults: true` reached `startHarness`
// from exactly two places — `capture.ts`'s measured branch and the source
// preflight — and neither had ever run. The pilot's first action was untested
// code, and it was broken: the harness recorded a target's url at attach time,
// before it had navigated, and so never recognised the dashboard. Four runs
// out of four hung, on a healthy app.
//
// The gap that made it invisible is small and worth naming: a measured launch
// needs routing to be CONFIGURED, not reachable. Nothing is billed until a
// command is submitted, and this submits none. So the whole composition can be
// exercised against an address that does not answer, and the one thing this
// asserts — that a measured launch reaches a usable app — could have been
// asserted on the day the composition was written.
//
// WHAT THIS DOES NOT COVER. The original bug was a race, and whether it is
// lost depends on how busy the main process is while the first window opens;
// ad blocking is off here so the suite stays offline and fast, which is the
// side of the race that always won. The startup wait no longer depends on
// winning it — it re-reads `Target.getTargets` — so this test guards the
// composition rather than the timing. The timing is covered by
// `sourceAccess.preflight.test.ts`, which runs with the real filter lists.

/** Routing that is configured and deliberately unreachable: composed, never called. */
const UNREACHABLE_ROUTING: Record<string, string> = {
  BINGBONG_ORCHESTRATOR_BASE_URL: 'http://127.0.0.1:1/v1',
  BINGBONG_ORCHESTRATOR_MODEL: 'unreachable-by-design',
  BINGBONG_ORCHESTRATOR_API_KEY: 'not-a-real-key',
}

/** No env file: the composition takes everything from the process env below. */
const NO_ENV_FILE: EnvFileInput = { path: '/nonexistent/.env', present: false, values: {} }

describe('a measured launch (#227)', () => {
  let harness: Harness | null = null
  let profile: BenchmarkProfile | null = null

  afterEach(async () => {
    if (harness) await harness.quit().catch(() => {})
    harness = null
    profile?.dispose()
    profile = null
  })

  it(
    'comes up on a benchmark profile, with production defaults and no fixture',
    async () => {
      profile = createBenchmarkProfile()
      const composed = composeMeasuredLaunch({
        profile,
        envFile: NO_ENV_FILE,
        processEnv: { ...UNREACHABLE_ROUTING },
        git: gitProvenance(),
      })

      // The composition itself is the thing under test, so assert what it
      // decided before launching anything with it.
      expect(composed.productionDefaults).toBe(true)
      expect(composed.env.BINGBONG_LLM_SCRIPT).toBeUndefined()
      expect(composed.env.BINGBONG_SUBAGENT_LLM_SCRIPT).toBeUndefined()

      harness = await startHarness({
        userDataDir: profile.userDataDir,
        env: { ...composed.env, BINGBONG_ADBLOCK: 'off' },
        productionDefaults: composed.productionDefaults,
        startupTimeoutMs: 120_000,
      })

      // Coming up at all is the assertion. A dashboard that answers an
      // evaluation is an app the harness can actually drive — which is what
      // four hung runs did not have, and what a capture needs before it can
      // submit its first command.
      expect(harness.dashboardTargetId()).toBeDefined()
      expect(await harness.dashboardEval<boolean>('document.readyState === "complete"')).toBe(true)

      // And it is a real browse surface, not the fixture one: a measured
      // launch must have no evaluator-local page to reach.
      expect(() => harness!.fixture.url('/anything')).toThrow(/production defaults/)
    },
    5 * 60_000,
  )
})
