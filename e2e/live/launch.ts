// Launch composition (#224): the env one capture launches the app with,
// and the provenance that says what that env was. Two modes, composed
// by two functions that share nothing by accident.
//
// Measured: the developer's effective production routing (repo `.env`
// under the process env, resolved the way the app resolves it), every
// scripted serving hook killed — the orchestrator's, the worker's, both
// vision hooks, the ear's — and every test-only timing override unset,
// with the app pointed at the same env file it reads in production.
// A `.env` that itself carries a hook or an override is refused rather
// than filtered: the app fills gaps from that file, so an unset process
// value would silently let the file's value through.
//
// Verification: the ordinary hermetic harness template, the caller's
// scripted model, and a refusal of any real routing credential.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_ROLES, REASONING_EFFORT_ENV_KEY, routingEnvKeys, type AgentRole } from '../../src/core/agent/modelRouting'
import { layerEnv, parseDotEnv } from '../../src/core/settings/dotEnv'
import { resolveEnvFilePath } from '../../src/main/envFile'
import { HOST_TRACE_ENV, RUN_TRACE_ENV } from '../../src/core/trace/traceFlags'
import { MEASUREMENT_ACCESS_GUARD_ENV } from '../../src/core/browser/measurementAccessGuard'
import { resolveProductionRouting, type ProductionRouting } from '../eval/routing'
import type { FixtureServer } from '../fixtureServer'
import { hermeticEnvTemplate } from '../harness'
import { digestOf } from './artifacts.ts'
import type { BenchmarkProfile } from './profile.ts'
import type { LiveCaptureMode, LiveLaunchProvenance, LiveRoleProvenance } from './types.ts'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Every env hook that puts a scripted double in a serving position. */
export const SCRIPTED_SERVING_HOOKS = [
  'BINGBONG_LLM_SCRIPT',
  'BINGBONG_SUBAGENT_LLM_SCRIPT',
  'BINGBONG_VISION_SCRIPT',
  'BINGBONG_VISION_DESCRIPTION_SCRIPT',
  'BINGBONG_STT_SCRIPT',
  'BINGBONG_VAD_SCRIPT',
  'BINGBONG_WAKE_SCRIPT',
] as const

/** The test-only timing overrides production never sets. */
export const TEST_ONLY_OVERRIDES = [
  'BINGBONG_ACTIVE_WORK_DEADLINE_MS',
  'BINGBONG_FINALIZATION_ALLOWANCE_MS',
  'BINGBONG_REPORT_GRACE_MS',
  'BINGBONG_ASK_TIMEOUT_MS',
  'BINGBONG_SESSION_WINDOW_MS',
  'BINGBONG_SESSION_WARNING_MS',
  'BINGBONG_IDLE_TIMEOUT_MS',
  'BINGBONG_VISION_TIMEOUT_MS',
  'BINGBONG_TAB_LINGER_MS',
  'BINGBONG_CONTINUITY_BUDGETS',
] as const

/** Env keys whose values are credentials — redacted from everything a capture writes. */
const SECRET_KEY_PATTERN = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/

export interface ComposedLaunch {
  readonly mode: LiveCaptureMode
  /** The `env` option for `startHarness`. */
  readonly env: Record<string, string | undefined>
  /** The `productionDefaults` option for `startHarness`. */
  readonly productionDefaults: boolean
  /** Values to redact from every retained file. */
  readonly secrets: readonly string[]
  readonly provenance: LiveLaunchProvenance
}

export interface GitProvenance {
  readonly commit: string
  readonly dirtyTree: boolean
  readonly dirtyPaths: readonly string[]
}

const DIRTY_PATHS_CAP = 40

/** The working tree the capture ran from; `unknown` when git is unavailable. */
export function gitProvenance(cwd: string = repoRoot): GitProvenance {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim()
    const status = execFileSync('git', ['status', '--porcelain'], { cwd })
      .toString()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => line.slice(3))
    return { commit, dirtyTree: status.length > 0, dirtyPaths: status.slice(0, DIRTY_PATHS_CAP) }
  } catch {
    return { commit: 'unknown', dirtyTree: false, dirtyPaths: [] }
  }
}

/** The env file the app would read in production, and what it holds. */
export interface EnvFileInput {
  readonly path: string
  readonly present: boolean
  readonly values: Record<string, string>
}

/** Read the production env file the way the app resolves it. */
export function loadEnvFile(processEnv: Record<string, string | undefined> = process.env, appPath: string = repoRoot): EnvFileInput {
  const path = resolveEnvFilePath(processEnv, appPath)
  if (!existsSync(path)) return { path, present: false, values: {} }
  return { path, present: true, values: parseDotEnv(readFileSync(path, 'utf8')) }
}

function present(env: Record<string, string | undefined>, keys: readonly string[]): string[] {
  return keys.filter((key) => typeof env[key] === 'string' && env[key]!.trim() !== '')
}

function secretsOf(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.length >= 6)
    .map(([, value]) => value as string)
}

function rolesOf(routing: ProductionRouting): Record<AgentRole, LiveRoleProvenance> {
  return Object.fromEntries(
    AGENT_ROLES.map((role) => {
      const identity = routing.identity[role]
      return [
        role,
        identity.configured
          ? { configured: true, baseUrl: identity.baseUrl, model: identity.model, keyFingerprint: identity.keyFingerprint }
          : { configured: false, reason: 'not configured in the production env' },
      ]
    }),
  ) as Record<AgentRole, LiveRoleProvenance>
}

function adblockProvenance(env: Record<string, string | undefined>): LiveLaunchProvenance['adblock'] {
  if (env.BINGBONG_ADBLOCK === 'off') return { lists: 'disabled', listsOverride: null, resourcesOverride: env.BINGBONG_ADBLOCK_RESOURCES ?? null }
  return {
    lists: env.BINGBONG_ADBLOCK_LISTS === undefined ? 'production_default' : 'override',
    listsOverride: env.BINGBONG_ADBLOCK_LISTS ?? null,
    resourcesOverride: env.BINGBONG_ADBLOCK_RESOURCES ?? null,
  }
}

export interface MeasuredLaunchInput {
  readonly profile: BenchmarkProfile
  readonly envFile: EnvFileInput
  readonly processEnv: Record<string, string | undefined>
  readonly git: GitProvenance
  /** Whether the file: access guard is turned on; true unless a caller says otherwise. */
  readonly accessGuard?: boolean
}

/**
 * Compose a measured launch. Throws — before any Electron launch or
 * model spend — when the orchestrator is not routed, when the env file
 * carries a scripted hook or a test-only override, or when the composed
 * env still holds one.
 */
export function composeMeasuredLaunch(input: MeasuredLaunchInput): ComposedLaunch {
  const { profile, envFile, processEnv, git } = input
  const accessGuard = input.accessGuard ?? true
  const fileHooks = present(envFile.values, [...SCRIPTED_SERVING_HOOKS, ...TEST_ONLY_OVERRIDES])
  if (fileHooks.length > 0) {
    throw new Error(
      `measured mode refuses the env file ${envFile.path}: it carries ${fileHooks.join(', ')}, which the app would read past any process-env unset — remove them from the file`,
    )
  }
  // The app's own precedence, by the app's own function: file fills gaps,
  // process env wins.
  const productionEnv = layerEnv(envFile.values, processEnv)
  const routing = resolveProductionRouting(productionEnv)

  const env: Record<string, string | undefined> = {
    ...routing.env,
    // The app reads the same file production reads, for everything the
    // routing composition above did not pin explicitly.
    BINGBONG_ENV_FILE: envFile.path,
    // Typed capture: no microphone, recorded as such in the provenance.
    BINGBONG_WAKE_ENGINE: 'off',
    [RUN_TRACE_ENV]: '1',
    [HOST_TRACE_ENV]: '1',
    BINGBONG_DOWNLOADS_DIR: profile.downloadsDir,
    [MEASUREMENT_ACCESS_GUARD_ENV]: accessGuard ? '1' : undefined,
    // No CLI harness, no audio dumps of a benchmark.
    BINGBONG_CLI: undefined,
    BINGBONG_AUDIO_DUMP: undefined,
  }
  for (const hook of SCRIPTED_SERVING_HOOKS) env[hook] = undefined
  for (const override of TEST_ONLY_OVERRIDES) env[override] = undefined
  const stillScripted = present(env, SCRIPTED_SERVING_HOOKS)
  const stillOverridden = present(env, TEST_ONLY_OVERRIDES)
  if (stillScripted.length > 0 || stillOverridden.length > 0) {
    throw new Error(`composed measured env still carries ${[...stillScripted, ...stillOverridden].join(', ')}`)
  }

  const provenance: LiveLaunchProvenance = {
    mode: 'measured',
    commit: git.commit,
    dirtyTree: git.dirtyTree,
    dirtyPaths: git.dirtyPaths,
    platform: { node: process.version, os: `${process.platform} ${process.arch}`, electron: electronVersion() },
    roles: rolesOf(routing),
    reasoningEffortOverride: routing.reasoningEffort,
    effortOverrides: {},
    envFile: {
      path: envFile.path,
      present: envFile.present,
      digest: envFile.present ? digestOf(JSON.stringify(Object.keys(envFile.values).sort())) : null,
    },
    settings: profile.settings,
    // The adblocker reads the process env at boot, never the env file:
    // provenance reads exactly what the launched app will.
    adblock: adblockProvenance(processEnv),
    scriptedHooks: [],
    wakeMonitoring: 'off',
    traceFlags: { runTrace: true, hostTrace: true },
    profile: { seed: 'fresh_benchmark', downloadsDir: 'benchmark_owned' },
    accessGuard,
  }
  return {
    mode: 'measured',
    env,
    productionDefaults: true,
    // Redact what the app can actually see: the routing it was handed,
    // the production env, and the real process env it inherits underneath.
    secrets: [...new Set([...secretsOf(routing.env), ...secretsOf(productionEnv), ...secretsOf(process.env)])],
    provenance,
  }
}

export interface VerificationLaunchInput {
  readonly profile: BenchmarkProfile
  /** The caller's scripted env: at least an orchestrator script. */
  readonly env: Record<string, string | undefined>
  readonly fixture: FixtureServer
  readonly git: GitProvenance
  readonly accessGuard?: boolean
}

/**
 * Compose a hermetic verification launch over the harness's ordinary
 * template. Refuses any real routing credential: verification never
 * falls back to a real model.
 */
export function composeVerificationLaunch(input: VerificationLaunchInput): ComposedLaunch {
  const { profile, fixture, git } = input
  const accessGuard = input.accessGuard ?? true
  const routingKeys = AGENT_ROLES.flatMap((role) => routingEnvKeys(role))
  const credentials = present(input.env, routingKeys)
  if (credentials.length > 0) throw new Error(`verification mode refuses real routing: ${credentials.join(', ')}`)
  const env: Record<string, string | undefined> = {
    ...input.env,
    BINGBONG_WAKE_ENGINE: 'off',
    [RUN_TRACE_ENV]: '1',
    [HOST_TRACE_ENV]: '1',
    BINGBONG_DOWNLOADS_DIR: profile.downloadsDir,
    [MEASUREMENT_ACCESS_GUARD_ENV]: accessGuard ? '1' : undefined,
  }
  const effective = { ...hermeticEnvTemplate(fixture, profile.userDataDir), ...env }
  const scriptedHooks = present(effective, SCRIPTED_SERVING_HOOKS)
  if (!scriptedHooks.includes('BINGBONG_LLM_SCRIPT')) {
    throw new Error('verification mode needs a scripted orchestrator (BINGBONG_LLM_SCRIPT) — it never reaches a real model')
  }
  const roles = Object.fromEntries(
    AGENT_ROLES.map((role) => [role, { configured: false, reason: `verification mode: ${scriptedFor(role, scriptedHooks)}` }]),
  ) as Record<AgentRole, LiveRoleProvenance>
  const effortOverrides = Object.fromEntries(present(effective, TEST_ONLY_OVERRIDES).map((key) => [key, effective[key] as string]))
  return {
    mode: 'verification',
    env,
    productionDefaults: false,
    // The hermetic template unsets only the routing keys; any other
    // credential exported in the shell reaches the app and is redacted too.
    secrets: [...new Set([...secretsOf(effective), ...secretsOf(process.env)])],
    provenance: {
      mode: 'verification',
      commit: git.commit,
      dirtyTree: git.dirtyTree,
      dirtyPaths: git.dirtyPaths,
      platform: { node: process.version, os: `${process.platform} ${process.arch}`, electron: electronVersion() },
      roles,
      reasoningEffortOverride: effective[REASONING_EFFORT_ENV_KEY] ?? null,
      effortOverrides,
      envFile: { path: effective.BINGBONG_ENV_FILE ?? '', present: false, digest: null },
      settings: profile.settings,
      adblock: adblockProvenance(effective),
      scriptedHooks,
      wakeMonitoring: 'off',
      traceFlags: { runTrace: true, hostTrace: true },
      profile: { seed: 'fresh_benchmark', downloadsDir: 'benchmark_owned' },
      accessGuard,
    },
  }
}

function scriptedFor(role: AgentRole, hooks: readonly string[]): string {
  const own: Record<AgentRole, readonly string[]> = {
    orchestrator: ['BINGBONG_LLM_SCRIPT'],
    subagent: ['BINGBONG_SUBAGENT_LLM_SCRIPT'],
    vision: ['BINGBONG_VISION_SCRIPT', 'BINGBONG_VISION_DESCRIPTION_SCRIPT'],
  }
  const set = own[role].filter((hook) => hooks.includes(hook))
  return set.length > 0 ? `scripted (${set.join(', ')})` : 'unconfigured'
}

function electronVersion(): string | null {
  try {
    return (JSON.parse(readFileSync(join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8')) as { version?: string }).version ?? null
  } catch {
    return null
  }
}
