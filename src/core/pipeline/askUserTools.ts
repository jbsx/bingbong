import type { Tool } from './tool'
import type { ToolCall } from '../ports/llm'

// ask_user (issue #18, Tier 3): any user-worthy clarification, not just
// popups. Two flavors share one name:
// - the orchestrator's tool declares `askUser`, so the command pipeline runs
//   the real ask flow (dashboard card + spoken prompt + voice/typed answer);
// - subagents cannot reach the user, so theirs returns an escalation
//   directive the workhorse includes in its report; the orchestrator relays
//   it through its own ask_user (and may re-dispatch with the answer).

/** Stable prefix the orchestrator scans subagent reports for. */
export const ASK_ESCALATION_PREFIX = 'ASK_USER:'

function questionArg(call: ToolCall): string {
  const value = call.args.question
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error("ask_user: 'question' must be a non-empty string")
  }
  return value.trim()
}

/**
 * The orchestrator's interactive ask — handled by the command pipeline.
 * Its question comes from the call's own arguments, never from a tool
 * result, so the Notice corruption a worker's relay was open to (#164) has
 * no analogue here: there is no result for a Notice to ride into the ask.
 */
export function createAskUserTool(): Tool {
  return {
    name: 'ask_user',
    description:
      'Ask the user a free-text question (clarifications, choices you cannot decide, dialog options). The question is shown on the dashboard and spoken; the user answers by voice or typing within ~45s. Returns their answer, or "user didn\'t answer" on timeout — then proceed safely or abandon.',
    parameters: {
      question: { type: 'string', description: 'Short, specific question to ask the user' },
    },
    askUser: questionArg,
    async execute() {
      // Unreachable when wired through the pipeline (askUser is declared);
      // guards direct-execution wiring mistakes.
      throw new Error('ask_user must run through the pipeline ask flow')
    },
  }
}

/** The subagent's escalation-only ask — never reaches the user directly. */
export function createSubagentAskTool(): Tool {
  return {
    name: 'ask_user',
    description:
      'Request an answer from the user. You cannot reach the user directly: returns an escalation directive. Finish your turn and include the directive verbatim in your final report — the orchestrator will ask the user and may re-dispatch you with the answer.',
    parameters: {
      question: { type: 'string', description: 'Short, specific question the user should answer' },
    },
    async execute(call) {
      const question = questionArg(call)
      return (
        `${ASK_ESCALATION_PREFIX} ${question} — you cannot ask the user directly. ` +
        'End your task now and include this directive verbatim in your final report; ' +
        'the orchestrator will ask the user and may re-dispatch you with the answer.'
      )
    },
  }
}
