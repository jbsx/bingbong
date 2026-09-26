// Which Decision Model serves a Run (#275, ADR 0068): the scripted
// stand-in when `BINGBONG_DECISION_SCRIPT` is set (the pattern of the
// other `*_SCRIPT` hooks, so the seams' tests and the e2e suites run
// without spend), else Jev when the decision role resolves, else none —
// and none means every seam is off and the Run behaves as it always has.

import { createHash } from 'node:crypto'
import {
  DECISION_SCRIPT_ENV_KEY,
  resolveDecisionRouting,
  resolveDecisionSeams,
} from '../../core/agent/modelRouting.ts'
import {
  DECISION_UNAVAILABLE_REASONS,
  readDecisionAnswers,
  type ConfiguredDecisionModel,
  type DecisionModel,
  type DecisionQuestions,
  type DecisionResult,
  type DecisionUnavailableReason,
} from '../../core/ports/decisionModel.ts'
import { createJevDecisionModel } from './createJevDecisionModel.ts'



/** One scripted ask: the raw answers (read against the questions like a vendor's), or an unavailable reason. */
type ScriptEntry = { readonly answers: unknown } | { readonly unavailable: DecisionUnavailableReason }

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

export function createScriptedDecisionModel(raw: string): DecisionModel {
  const script = parseScript(raw)
  return {
    model: 'scripted',
    async ask<const Q extends DecisionQuestions>(request: { questions: Q }): Promise<DecisionResult<Q>> {
      const unavailable = (reason: DecisionUnavailableReason, message: string): DecisionResult<Q> => ({
        status: 'unavailable',
        reason,
        message,
        latencyMs: 0,
        model: 'scripted',
      })
      if ('error' in script) return unavailable('failed', script.error)
      const entry = script.entries.shift()
      if (entry === undefined) return unavailable('failed', `${DECISION_SCRIPT_ENV_KEY} ran out of answers`)
      if ('unavailable' in entry) return unavailable(entry.unavailable, `scripted ${entry.unavailable}`)
      const answers = readDecisionAnswers(request.questions, entry.answers)
      if (answers === null) return unavailable('malformed', 'the scripted answers did not match the questions asked')
      return { status: 'answered', answers, latencyMs: 0, model: 'scripted' }
    },
  }
}

export function createDecisionModel(env: Record<string, string | undefined>): ConfiguredDecisionModel | null {
  const seams = resolveDecisionSeams(env)
  const script = env[DECISION_SCRIPT_ENV_KEY]?.trim()
  if (script) return { model: createScriptedDecisionModel(script), seams }
  const routing = resolveDecisionRouting(env)
  if (!routing.configured) return null
  return { model: createJevDecisionModel(routing.endpoint), seams }
}

/**
 * The per-Run lookup the pipeline takes: the env is read on every call, as
 * the LLM's routing is, but one model is kept while the decision config is
 * unchanged — a scripted stand-in is consumed in order across Runs, and a
 * settings change that touches the role builds a new one.
 */
export function createDecisionModelSource(getEnv: () => Record<string, string | undefined>): () => ConfiguredDecisionModel | null {
  let signature: string | undefined
  let current: ConfiguredDecisionModel | null = null
  return () => {
    const env = getEnv()
    // Hashed, so the key is not kept in a plain string beside the client that holds it.
    const next = createHash('sha256')
      .update(JSON.stringify([env[DECISION_SCRIPT_ENV_KEY]?.trim() ?? null, resolveDecisionRouting(env), [...resolveDecisionSeams(env)]]))
      .digest('hex')
    if (next !== signature) {
      signature = next
      current = createDecisionModel(env)
    }
    return current
  }
}
