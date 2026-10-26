// Which Decision Model serves: the scripted stand-in when
// `BINGBONG_DECISION_SCRIPT` is set (the pattern of the other `*_SCRIPT`
// hooks, so tests and the e2e suites run without spend), else the model
// the decision role resolves to — Jev by default, any host of its
// protocol by env (#395) — else none.

import { createHash } from 'node:crypto'
import { DECISION_SCRIPT_ENV_KEY, resolveDecisionRouting, type ConfiguredDecisionRouting, type ModelEndpointConfig } from '../../core/decision/decisionRouting.ts'
import { withFallbacks } from '../../core/decision/fallbackChain.ts'
import {
  DECISION_UNAVAILABLE_REASONS,
  readDecisionAnswers,
  type DecisionModel,
  type DecisionQuestions,
  type DecisionResult,
  type DecisionUnavailableReason,
} from '../../core/ports/decisionModel.ts'
import { createJevDecisionModel } from './createJevDecisionModel.ts'

/**
 * One scripted ask: the raw answers (read against the questions like a
 * vendor's), or an unavailable reason. With `when`, it answers only an ask
 * whose state carries those words — a line's reading, never a consent
 * wall's ask that came first; without, the next ask in order. With
 * `delayMs`, it answers that much later, as a slow model would (#428).
 */
type ScriptEntry = ({ readonly answers: unknown } | { readonly unavailable: DecisionUnavailableReason }) & { readonly when?: string; readonly delayMs?: number }

function isScriptEntry(value: unknown): value is ScriptEntry {
  if (typeof value !== 'object' || value === null) return false
  if ('answers' in value) return true
  const reason = (value as { unavailable?: unknown }).unavailable
  return DECISION_UNAVAILABLE_REASONS.some((known) => known === reason)
}

/** Parse the script once; a broken one leaves an error every ask reports. */
function parseScript(raw: string): { entries: ScriptEntry[] } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { error: `${DECISION_SCRIPT_ENV_KEY} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!Array.isArray(parsed) || !parsed.every(isScriptEntry)) {
    return { error: `${DECISION_SCRIPT_ENV_KEY} must be a list of {"answers": {…}} or {"unavailable": "<reason>"} entries` }
  }
  return { entries: [...parsed] }
}

/**
 * A script's answers with each Choice's probabilities filled in: the
 * chosen label at its confidence, every other option at 0 unless the
 * script gives it one — so a script names a label alone, never every ref
 * and span of a page it cannot know. A label ending in `*` is the first
 * option it begins (`volume-*`): a live page's ref, by kind (#459).
 */
function withChoicesFilled(questions: DecisionQuestions, raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const filled: Record<string, unknown> = { ...raw }
  for (const [key, question] of Object.entries(questions)) {
    const answer = filled[key]
    if (question.type !== 'choice' || typeof answer !== 'object' || answer === null) continue
    const { choice, confidence, probabilities } = answer as { choice?: unknown; confidence?: unknown; probabilities?: unknown }
    const given = typeof probabilities === 'object' && probabilities !== null ? probabilities : {}
    const label = typeof choice === 'string' && choice.endsWith('*') ? (Object.keys(question.options).find((option) => option.startsWith(choice.slice(0, -1))) ?? choice) : choice
    const chosen = typeof label === 'string' ? { [label]: confidence } : {}
    filled[key] = { ...answer, ...(typeof label === 'string' ? { choice: label } : {}), probabilities: { ...Object.fromEntries(Object.keys(question.options).map((label) => [label, 0])), ...chosen, ...given } }
  }
  return filled
}

export function createScriptedDecisionModel(raw: string): DecisionModel {
  const script = parseScript(raw)
  return {
    model: 'scripted',
    async ask<const Q extends DecisionQuestions>(request: { state: string; questions: Q }): Promise<DecisionResult<Q>> {
      const unavailable = (reason: DecisionUnavailableReason, message: string): DecisionResult<Q> => ({
        status: 'unavailable',
        reason,
        message,
        latencyMs: 0,
        model: 'scripted',
      })
      if ('error' in script) return unavailable('failed', script.error)
      const at = script.entries.findIndex((candidate) => candidate.when === undefined || request.state.includes(candidate.when))
      const entry = at < 0 ? undefined : script.entries.splice(at, 1)[0]
      if (entry === undefined) return unavailable('failed', `${DECISION_SCRIPT_ENV_KEY} ran out of answers`)
      if (entry.delayMs !== undefined && entry.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, entry.delayMs))
      if ('unavailable' in entry) return unavailable(entry.unavailable, `scripted ${entry.unavailable}`)
      const answers = readDecisionAnswers(request.questions, withChoicesFilled(request.questions, entry.answers))
      if (answers === null) return unavailable('malformed', 'the scripted answers did not match the questions asked')
      return { status: 'answered', answers, latencyMs: 0, model: 'scripted' }
    },
  }
}

/**
 * The adapter for the routing's protocol, with its timeout and images
 * setting, over the live host and then the Fallback Hosts (#477): every
 * attempt with a host after it times out at the routing's fallback
 * timeout, the last at its timeout, so no fallback is one host and one
 * timeout as before. `timeoutMs` in place of the routing's for `pnpm
 * jev:replay`, which costs no round; `fallbacks: false` for the gate and
 * the replay, which ask exactly the model they name (ruling 11 of #477).
 */
export function createRoutedDecisionModel(routing: ConfiguredDecisionRouting, overrides: { readonly timeoutMs?: number; readonly fallbacks?: boolean } = {}): DecisionModel {
  const hosts = overrides.fallbacks === false ? [routing.endpoint] : [routing.endpoint, ...routing.fallbacks]
  const adapter = (endpoint: ModelEndpointConfig, last: boolean): DecisionModel => {
    const timeoutMs = overrides.timeoutMs ?? (last ? routing.timeoutMs : routing.fallbackTimeoutMs)
    switch (routing.protocol) {
      case 'systemone':
        return { ...createJevDecisionModel(endpoint, { timeoutMs, images: routing.images }), cardBudget: routing.cardBudget }
    }
  }
  return withFallbacks(hosts.map((endpoint, index) => ({ model: adapter(endpoint, index === hosts.length - 1), host: endpoint.baseUrl })))
}

export function createDecisionModel(env: Record<string, string | undefined>): DecisionModel | null {
  const script = env[DECISION_SCRIPT_ENV_KEY]?.trim()
  if (script) return createScriptedDecisionModel(script)
  const routing = resolveDecisionRouting(env)
  if (!routing.configured) return null
  return createRoutedDecisionModel(routing)
}

/**
 * The per-run lookup: the env is read on every call, but one model is kept
 * while the decision config is unchanged — a scripted stand-in is consumed
 * in order across runs, and a settings change that touches the role builds
 * a new one.
 */
export function createDecisionModelSource(getEnv: () => Record<string, string | undefined>): () => DecisionModel | null {
  let signature: string | undefined
  let current: DecisionModel | null = null
  return () => {
    const env = getEnv()
    // Hashed, so the key is not kept in a plain string beside the client that holds it.
    const next = createHash('sha256')
      .update(JSON.stringify([env[DECISION_SCRIPT_ENV_KEY]?.trim() ?? null, resolveDecisionRouting(env)]))
      .digest('hex')
    if (next !== signature) {
      signature = next
      current = createDecisionModel(env)
    }
    return current
  }
}
