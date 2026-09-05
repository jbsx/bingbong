import { AGENT_ROLES, routingEnvPrefix } from '../../core/agent/modelRouting'
import type { RunPlanModels } from '../../core/trace/runTrace'

// Which model each role is routed to (#191): what the Run Trace stamps on
// a `run_plan` record so runs across a model switch are told apart from
// the file. It reads the same env the clients resolve from — the model
// id per role, or the scripted double's name where a script stands in —
// and names nothing for a role with no model configured, because a
// missing role is not a fault here: the client that needs it reports
// that when a Run actually asks for it.

/** The scripted double's env hooks, per role: set, that role is served by `scripted`. */
const SCRIPT_ENVS: Record<(typeof AGENT_ROLES)[number], readonly string[]> = {
  orchestrator: ['BINGBONG_LLM_SCRIPT'],
  subagent: ['BINGBONG_SUBAGENT_LLM_SCRIPT'],
  vision: ['BINGBONG_VISION_SCRIPT', 'BINGBONG_VISION_DESCRIPTION_SCRIPT'],
}

function setEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

export function resolveRoleModels(env: Record<string, string | undefined>): RunPlanModels {
  const models: Partial<Record<(typeof AGENT_ROLES)[number], string>> = {}
  for (const role of AGENT_ROLES) {
    const scripted = SCRIPT_ENVS[role].some((name) => setEnv(env, name) !== undefined)
    const model = scripted ? 'scripted' : setEnv(env, `${routingEnvPrefix(role)}_MODEL`)
    if (model !== undefined) models[role] = model
  }
  return models
}
