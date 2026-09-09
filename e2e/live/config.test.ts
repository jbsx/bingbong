import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIVE_ARTIFACTS_ROOT } from './artifacts.ts'

// The pilot is the one suite in this repo that both spends model budget and
// browses the real web. Everything that keeps it from running by accident is
// a glob in a config file, and a glob is exactly the kind of thing that gets
// quietly edited. So the arrangement is asserted rather than trusted.
//
// The configs are read as text on purpose: importing them would prove the
// module evaluates, not that the pattern a developer would grep for is
// actually written down where the runner reads it.

const repoRoot = join(import.meta.dirname, '..', '..')
const read = (name: string): string => readFileSync(join(repoRoot, name), 'utf8')

describe('the live-web pilot cannot run by accident', () => {
  it('is excluded from the unit suite', () => {
    // `e2e/**/*.test.ts` is included, so `pilot.live.test.ts` would otherwise
    // ride `pnpm test` — launching Electron and spending real budget on a
    // command a developer thought was free.
    expect(read('vitest.config.ts')).toContain("'e2e/**/*.live.test.ts'")
  })

  it('is matched by no suite but its own', () => {
    expect(read('vitest.e2e.config.ts')).toContain("include: ['e2e/**/*.e2e.test.ts']")
    expect(read('vitest.eval.config.ts')).toContain("include: ['e2e/eval/**/*.eval.test.ts']")
    expect(read('vitest.delegation.config.ts')).toContain("include: ['e2e/eval/**/*.probe.test.ts']")
    expect(read('vitest.live.config.ts')).toContain("include: ['e2e/live/**/*.live.test.ts']")
    expect(read('vitest.preflight.config.ts')).toContain("include: ['e2e/live/**/*.preflight.test.ts']")
  })

  it('keeps the live-access preflight opt-in too', () => {
    // It spends no model budget, but it contacts live websites, so it earns
    // the same treatment: excluded from the unit suite, under Xvfb, one app
    // at a time.
    expect(read('vitest.config.ts')).toContain("'e2e/**/*.preflight.test.ts'")
    expect(read('vitest.preflight.config.ts')).toContain('fileParallelism: false')
    expect(read('package.json')).toContain('"live:preflight": "pnpm build && xvfb-run')
  })

  it('runs one app at a time, under Xvfb', () => {
    // Each hunt launches its own app whose synthetic input needs OS focus;
    // two at once fight over it. And no Electron suite may ever open windows
    // on the developer's real display.
    expect(read('vitest.live.config.ts')).toContain('fileParallelism: false')
    expect(read('package.json')).toContain('"test:live": "pnpm build && xvfb-run')
  })

  it('does not drag the preflight along with it', () => {
    // The preflight (#227) exists to run BEFORE the pilot and help decide
    // whether the pilot should run at all. If one config matched both, then
    // "check the sources first" and "spend the budget" would be one command,
    // and the check would stop being a check.
    expect(read('vitest.live.config.ts')).not.toContain('preflight')
    expect(read('vitest.preflight.config.ts')).not.toContain('live.test.ts')
  })

  it('writes nowhere near the release and delegation corpora', () => {
    // Neither pooled artifact directory may collect a live-web capture: the
    // release decision pools identical scenario ids against a pinned
    // baseline, and this study shares none of that shape. Checked against the
    // path the study actually writes to, not against what a config says.
    const root = LIVE_ARTIFACTS_ROOT.split(sep).join('/')
    expect(root).toContain('/e2e/live/artifacts')
    expect(root).not.toContain('/e2e/eval')
  })
})
