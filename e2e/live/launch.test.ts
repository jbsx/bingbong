import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FixtureServer } from '../fixtureServer'
import { composeMeasuredLaunch, composeVerificationLaunch, SCRIPTED_SERVING_HOOKS, TEST_ONLY_OVERRIDES, type GitProvenance } from './launch.ts'
import { createBenchmarkProfile, type BenchmarkProfile } from './profile.ts'

// Launch composition (#224): what reaches the launched app in measured
// mode is production routing and nothing scripted; in verification mode
// it is scripted and nothing real. Both are checked here without a launch.

const git: GitProvenance = { commit: 'abc', dirtyTree: true, dirtyPaths: ['todo'] }

const PRODUCTION = {
  BINGBONG_ORCHESTRATOR_BASE_URL: 'https://orchestrator.example/v4',
  BINGBONG_ORCHESTRATOR_MODEL: 'glm-test',
  BINGBONG_ORCHESTRATOR_API_KEY: 'sk-orchestrator-key-123',
  BINGBONG_SUBAGENT_BASE_URL: 'https://worker.example/v1',
  BINGBONG_SUBAGENT_MODEL: 'worker-test',
  DEEPSEEK_API_KEY: 'sk-worker-key-456',
}

const fixture = { url: (path: string) => `http://127.0.0.1:1${path}` } as FixtureServer

describe('composeMeasuredLaunch', () => {
  let root: string
  let profile: BenchmarkProfile
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'live-launch-test-'))
    profile = createBenchmarkProfile({ root, settings: 'defaults' })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('kills every scripted hook and test-only override from the process env, and pins production routing', () => {
    const composed = composeMeasuredLaunch({
      profile,
      git,
      envFile: { path: '/repo/.env', present: true, values: { BINGBONG_ORCHESTRATOR_MODEL: 'from-file' } },
      processEnv: {
        ...PRODUCTION,
        BINGBONG_LLM_SCRIPT: '[]',
        BINGBONG_SUBAGENT_LLM_SCRIPT: '[]',
        BINGBONG_VISION_SCRIPT: '[]',
        BINGBONG_ACTIVE_WORK_DEADLINE_MS: '1000',
        BINGBONG_REPORT_GRACE_MS: '0',
        BINGBONG_REASONING_EFFORT: 'high',
      },
    })
    for (const hook of SCRIPTED_SERVING_HOOKS) expect(composed.env[hook]).toBeUndefined()
    for (const override of TEST_ONLY_OVERRIDES) expect(composed.env[override]).toBeUndefined()
    expect(composed.env).toMatchObject({
      BINGBONG_ORCHESTRATOR_MODEL: 'glm-test',
      BINGBONG_SUBAGENT_API_KEY: 'sk-worker-key-456',
      BINGBONG_ENV_FILE: '/repo/.env',
      BINGBONG_WAKE_ENGINE: 'off',
      BINGBONG_RUN_TRACE: '1',
      BINGBONG_HOST_TRACE: '1',
      BINGBONG_DOWNLOADS_DIR: profile.downloadsDir,
      BINGBONG_MEASUREMENT_ACCESS_GUARD: '1',
      BINGBONG_REASONING_EFFORT: 'high',
    })
    expect(composed.productionDefaults).toBe(true)
    expect(composed.provenance).toMatchObject({
      mode: 'measured',
      commit: 'abc',
      dirtyTree: true,
      scriptedHooks: [],
      effortOverrides: {},
      reasoningEffortOverride: 'high',
      adblock: { lists: 'production_default', listsOverride: null },
      wakeMonitoring: 'off',
      accessGuard: true,
      envFile: { path: '/repo/.env', present: true },
    })
    expect(composed.provenance.roles.orchestrator).toMatchObject({ configured: true, model: 'glm-test', baseUrl: 'https://orchestrator.example/v4' })
    expect(composed.provenance.roles.vision).toEqual({ configured: false, reason: 'not configured in the production env' })
    // Keys reach the app and the redaction list, never the provenance.
    expect(JSON.stringify(composed.provenance)).not.toContain('sk-orchestrator-key-123')
    expect(composed.secrets).toEqual(expect.arrayContaining(['sk-orchestrator-key-123', 'sk-worker-key-456']))
  })

  it('records the decision role and the seam list, and pins an unconfigured role empty past the env file (#279)', () => {
    const on = composeMeasuredLaunch({
      profile,
      git,
      envFile: { path: '/repo/.env', present: true, values: { TYPESAFE_API_KEY: 'ts-decision-key-789' } },
      processEnv: { ...PRODUCTION, BINGBONG_DECISION_SEAMS: 'passage,result' },
    })
    expect(on.provenance.roles.decision).toMatchObject({ configured: true, model: 'jev-1.13.0', baseUrl: 'https://api.typesafe.ai' })
    expect(on.provenance.decisionSeams).toBe('passage,result')
    expect(on.env).toMatchObject({ BINGBONG_DECISION_API_KEY: 'ts-decision-key-789', BINGBONG_DECISION_SEAMS: 'passage,result' })
    expect(JSON.stringify(on.provenance)).not.toContain('ts-decision-key-789')
    expect(on.secrets).toContain('ts-decision-key-789')

    // The unconfigured arm: the key exported empty wins over the file, and the
    // composed env pins every decision key empty so the app — which reads the
    // same file — cannot find one there either.
    const off = composeMeasuredLaunch({
      profile,
      git,
      envFile: { path: '/repo/.env', present: true, values: { TYPESAFE_API_KEY: 'ts-decision-key-789' } },
      processEnv: { ...PRODUCTION, TYPESAFE_API_KEY: '' },
    })
    expect(off.provenance.roles.decision).toEqual({ configured: false, reason: 'not configured in the production env' })
    expect(off.provenance.decisionSeams).toBeNull()
    expect(off.env.TYPESAFE_API_KEY).toBe('')
    expect(off.env.BINGBONG_DECISION_API_KEY).toBe('')
  })

  it('refuses an env file that carries a hook or an override — the app would read it past any unset', () => {
    expect(() =>
      composeMeasuredLaunch({
        profile,
        git,
        envFile: { path: '/repo/.env', present: true, values: { BINGBONG_SUBAGENT_LLM_SCRIPT: '[]', BINGBONG_ASK_TIMEOUT_MS: '5' } },
        processEnv: PRODUCTION,
      }),
    ).toThrow(/refuses the env file .*BINGBONG_SUBAGENT_LLM_SCRIPT, BINGBONG_ASK_TIMEOUT_MS/)
  })

  it('fails fast without an orchestrator and reads adblock overrides from the process env alone', () => {
    expect(() => composeMeasuredLaunch({ profile, git, envFile: { path: '/repo/.env', present: false, values: {} }, processEnv: {} })).toThrow(
      /orchestrator routing/,
    )
    const composed = composeMeasuredLaunch({
      profile,
      git,
      envFile: { path: '/repo/.env', present: true, values: { BINGBONG_ADBLOCK_LISTS: 'http://file-only.example/list' } },
      processEnv: { ...PRODUCTION, BINGBONG_ADBLOCK_LISTS: 'http://shell.example/list' },
    })
    expect(composed.provenance.adblock).toEqual({ lists: 'override', listsOverride: 'http://shell.example/list', resourcesOverride: null })
    expect(composed.env.BINGBONG_ADBLOCK_LISTS).toBeUndefined()
  })

  it('records the browser sub-spans flag the app will read — process env over file, off when neither sets it (#247)', () => {
    const envFile = { path: '/repo/.env', present: true, values: {} }
    expect(composeMeasuredLaunch({ profile, git, envFile, processEnv: PRODUCTION }).provenance.traceFlags).toEqual({
      runTrace: true,
      hostTrace: true,
      browserSubspans: false,
    })
    expect(composeMeasuredLaunch({ profile, git, envFile, processEnv: { ...PRODUCTION, BINGBONG_BROWSER_SUBSPANS: '1' } }).provenance.traceFlags.browserSubspans).toBe(true)
    // The app layers the env file under the process env, so a file-only flag counts too.
    expect(
      composeMeasuredLaunch({ profile, git, envFile: { ...envFile, values: { BINGBONG_BROWSER_SUBSPANS: 'true' } }, processEnv: PRODUCTION }).provenance.traceFlags
        .browserSubspans,
    ).toBe(true)
    expect(
      composeMeasuredLaunch({ profile, git, envFile: { ...envFile, values: { BINGBONG_BROWSER_SUBSPANS: '1' } }, processEnv: { ...PRODUCTION, BINGBONG_BROWSER_SUBSPANS: '0' } })
        .provenance.traceFlags.browserSubspans,
    ).toBe(false)
  })
})

describe('composeVerificationLaunch', () => {
  let root: string
  let profile: BenchmarkProfile
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'live-launch-test-'))
    profile = createBenchmarkProfile({ root, settings: 'defaults' })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('rides the hermetic template, records the scripted hooks and overrides, and never reaches a real model', () => {
    const composed = composeVerificationLaunch({
      profile,
      fixture,
      git,
      env: { BINGBONG_LLM_SCRIPT: '[{"kind":"answer","speak":"x","display":"x"}]', BINGBONG_REPORT_GRACE_MS: '0' },
    })
    expect(composed.productionDefaults).toBe(false)
    expect(composed.env).toMatchObject({ BINGBONG_WAKE_ENGINE: 'off', BINGBONG_RUN_TRACE: '1', BINGBONG_DOWNLOADS_DIR: profile.downloadsDir })
    expect(composed.provenance).toMatchObject({
      mode: 'verification',
      scriptedHooks: ['BINGBONG_LLM_SCRIPT', 'BINGBONG_VISION_SCRIPT', 'BINGBONG_VISION_DESCRIPTION_SCRIPT'],
      effortOverrides: { BINGBONG_REPORT_GRACE_MS: '0' },
      adblock: { lists: 'override', listsOverride: 'http://127.0.0.1:1/adblock-list', resourcesOverride: '' },
    })
    expect(composed.provenance.roles.orchestrator).toEqual({ configured: false, reason: 'verification mode: scripted (BINGBONG_LLM_SCRIPT)' })
    expect(composed.provenance.roles.subagent).toEqual({ configured: false, reason: 'verification mode: unconfigured' })
    expect(composed.provenance.roles.decision).toEqual({ configured: false, reason: 'verification mode: unconfigured' })
    expect(composed.provenance.decisionSeams).toBeNull()
  })

  it('records a scripted decision role and its seam list, and refuses a real decision key (#279)', () => {
    const composed = composeVerificationLaunch({
      profile,
      fixture,
      git,
      env: { BINGBONG_LLM_SCRIPT: '[]', BINGBONG_DECISION_SCRIPT: '[]', BINGBONG_DECISION_SEAMS: 'tier' },
    })
    expect(composed.provenance.roles.decision).toEqual({ configured: false, reason: 'verification mode: scripted (BINGBONG_DECISION_SCRIPT)' })
    expect(composed.provenance.decisionSeams).toBe('tier')
    expect(() => composeVerificationLaunch({ profile, fixture, git, env: { BINGBONG_LLM_SCRIPT: '[]', TYPESAFE_API_KEY: 'ts-real' } })).toThrow(
      /refuses real routing: TYPESAFE_API_KEY/,
    )
  })

  it('refuses a real routing credential and a launch without a scripted orchestrator', () => {
    expect(() => composeVerificationLaunch({ profile, fixture, git, env: { BINGBONG_LLM_SCRIPT: '[]', ZAI_API_KEY: 'sk-real' } })).toThrow(
      /refuses real routing: ZAI_API_KEY/,
    )
    expect(() => composeVerificationLaunch({ profile, fixture, git, env: {} })).toThrow(/needs a scripted orchestrator/)
  })
})
