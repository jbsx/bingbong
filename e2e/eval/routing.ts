import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENT_ROLES,
  DECISION_SEAMS_ENV_KEY,
  decisionEnvKeys,
  REASONING_EFFORT_ENV_KEY,
  resolveDecisionRouting,
  resolveModelEndpoint,
  resolveReasoningEffortOverride,
  type AgentRole,
  type ModelEndpointConfig,
} from '../../src/core/agent/modelRouting'
import type { ReasoningEffort } from '../../src/core/ports/llm'
import { layerEnv, parseDotEnv } from '../../src/core/settings/dotEnv'

// Real-model evaluation routing (#109): the evaluator must never inherit
// e2e's hermetic scripted defaults — it resolves the developer's production
// routing exactly the way the app would (repo `.env` under process env) and
// passes every value explicitly to the harness, so the only routing the
// launched app can see is what this module resolved and pinned into the
// report. The orchestrator role is required (the suite exists to exercise
// real model decisions); other roles ride along when configured.
//
// The decision role (#275) rides the same plumbing (#279): it is composed
// and fingerprinted like the three agent roles, so a configured versus
// unconfigured `decision` entry in the report is the Decision Model
// experiment's arm marker. It is not an AgentRole, so it is resolved beside
// them rather than in their loop. An unconfigured role has its keys pinned
// to empty strings rather than left out: a launch that points the app at
// the repo `.env` (the live study's) would otherwise let the file's
// TYPESAFE_API_KEY switch the role on behind a report that says it is off.
// The unconfigured arm is captured with the key exported empty
// (`TYPESAFE_API_KEY=`), which wins over the file.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Env hooks that would put a scripted model in any serving position —
 * the orchestrator's, the delegated worker's (#224: the one the guard
 * used to omit), both vision hooks, and the Decision Model's stand-in (#275).
 */
export const SCRIPTED_MODEL_HOOKS = [
  'BINGBONG_LLM_SCRIPT',
  'BINGBONG_SUBAGENT_LLM_SCRIPT',
  'BINGBONG_VISION_SCRIPT',
  'BINGBONG_VISION_DESCRIPTION_SCRIPT',
  'BINGBONG_DECISION_SCRIPT',
] as const

/** Every role a report records routing for: the three agent roles and the Decision Model's (#279). */
export type RoutedRole = AgentRole | 'decision'

/** A resolved role, or why it isn't serving. `unconfigured` never fails the suite. */
export type RoleRouting = { configured: true; baseUrl: string; model: string; keyFingerprint: string } | { configured: false }

/**
 * Per-role identity as a report records it. The decision entry is always
 * written from #279 on, and optional only because the pools read captures
 * taken before it (the pinned baseline among them).
 */
export type RoutingIdentity = Record<AgentRole, RoleRouting> & { decision?: RoleRouting }

export interface ProductionRouting {
  /** Explicit harness env values — one BASE_URL/MODEL/API_KEY trio per configured role, plus the scripted-model kills. */
  env: Record<string, string | undefined>
  /** Per-role identity for the report — fingerprints only, never keys. */
  identity: RoutingIdentity
  /**
   * The reasoning-effort override in force (#166), or null when the Effort
   * Tier map decides. Pinned into the report because `buildPool` refuses a
   * pool whose captures disagree about it, the way it refuses mixed commits
   * and mixed routing contracts.
   */
  reasoningEffort: ReasoningEffort | null
  /**
   * The `BINGBONG_DECISION_SEAMS` list forwarded (#279), trimmed, or null
   * when unset (every seam acts when the role serves); an empty string is
   * the list set empty, under which no seam acts (#275). Recorded as written,
   * not resolved: which seams act also depends on the role, which the
   * identity above already records.
   */
  decisionSeams: string | null
}

function fingerprint(apiKey: string): string {
  return `sha256:${createHash('sha256').update(apiKey).digest('hex').slice(0, 12)}`
}

function envPrefixOf(role: RoutedRole): string {
  return `BINGBONG_${role.toUpperCase()}`
}

/**
 * The env the app's own loader would see: repo `.env` layered under the
 * process environment (`.env` fills gaps; exported vars win). A missing
 * `.env` is fine — exported routing alone configures the roles.
 */
export async function loadProductionEnv(): Promise<Record<string, string | undefined>> {
  let fileValues: Record<string, string> = {}
  try {
    fileValues = parseDotEnv(await readFile(join(repoRoot, '.env'), 'utf8'))
  } catch {
    // No repo .env — process env is the whole config surface.
  }
  return layerEnv(fileValues, process.env)
}

/**
 * Resolve production routing for every role. Throws (fail-fast, before any
 * Electron launch or model spend) when the orchestrator role is not
 * configured — there is nothing to evaluate without a real orchestrator.
 */
export function resolveProductionRouting(env: Record<string, string | undefined>): ProductionRouting {
  const endpoints = new Map<AgentRole, ModelEndpointConfig>()
  for (const role of AGENT_ROLES) {
    try {
      endpoints.set(role, resolveModelEndpoint(env, role))
    } catch {
      // Unconfigured optional role — recorded honestly in the report.
    }
  }

  const orchestrator = endpoints.get('orchestrator')
  if (!orchestrator) {
    throw new Error(
      'real-model evaluation needs production orchestrator routing. Set BINGBONG_ORCHESTRATOR_BASE_URL, BINGBONG_ORCHESTRATOR_MODEL and a key (repo .env or exported env) — the scripted e2e default is deliberately not used here.',
    )
  }

  const decision = resolveDecisionRouting(env)
  const identityOf = (endpoint: ModelEndpointConfig | undefined): RoleRouting =>
    endpoint ? { configured: true, baseUrl: endpoint.baseUrl, model: endpoint.model, keyFingerprint: fingerprint(endpoint.apiKey) } : { configured: false }
  const identity = {
    ...Object.fromEntries(AGENT_ROLES.map((role) => [role, identityOf(endpoints.get(role))])),
    decision: identityOf(decision.configured ? decision.endpoint : undefined),
  } as RoutingIdentity

  // The developer's env never reaches the launched app on its own — this
  // module composes the whole routing surface — so the effort override is
  // forwarded explicitly or not at all (#166).
  const reasoningEffort = resolveReasoningEffortOverride(env) ?? null
  // Set but empty is the off switch that keeps the key (#275), so it is kept
  // apart from unset (every seam acts) rather than trimmed away.
  const decisionSeams = typeof env[DECISION_SEAMS_ENV_KEY] === 'string' ? env[DECISION_SEAMS_ENV_KEY]!.trim() : null
  const harnessEnv: Record<string, string | undefined> = {
    // Kill every scripted hook the ordinary harness template sets; the
    // invariant below proves the composed env cannot script a model.
    ...(Object.fromEntries(SCRIPTED_MODEL_HOOKS.map((hook) => [hook, undefined])) as Record<string, undefined>),
    ...(reasoningEffort !== null ? { [REASONING_EFFORT_ENV_KEY]: reasoningEffort } : {}),
    ...(decisionSeams !== null ? { [DECISION_SEAMS_ENV_KEY]: decisionSeams } : {}),
  }
  for (const [role, endpoint] of endpoints) {
    const prefix = envPrefixOf(role)
    // Explicit values (never the *_API_KEY_ENV indirection) so the launched
    // app's routing is exactly what this module resolved.
    harnessEnv[`${prefix}_BASE_URL`] = endpoint.baseUrl
    harnessEnv[`${prefix}_MODEL`] = endpoint.model
    harnessEnv[`${prefix}_API_KEY`] = endpoint.apiKey
  }
  for (const key of decisionEnvKeys()) if (key !== DECISION_SEAMS_ENV_KEY) harnessEnv[key] = ''
  if (decision.configured) {
    harnessEnv[`${envPrefixOf('decision')}_BASE_URL`] = decision.endpoint.baseUrl
    harnessEnv[`${envPrefixOf('decision')}_MODEL`] = decision.endpoint.model
    harnessEnv[`${envPrefixOf('decision')}_API_KEY`] = decision.endpoint.apiKey
  }
  if (!noScriptedModelActive(harnessEnv)) {
    throw new Error('composed app env still carries a scripted-model hook')
  }
  return { env: harnessEnv, identity, reasoningEffort, decisionSeams }
}

/** True when no scripted-model hook remains in the composed app env. */
export function noScriptedModelActive(appEnv: Record<string, string | undefined>): boolean {
  return SCRIPTED_MODEL_HOOKS.every((key) => appEnv[key] === undefined)
}
