// Model-invoked session reset (spec #24): the orchestrator decides a command
// like "bing bong, forget all that — different question" starts a fresh
// thread by calling new_session. The store is read live per LLM round, so the
// reset lands on the very next round of the same run; the result string is
// the only acknowledgment and the model's own reply carries it to the user.

import type { SessionResetSource } from '../session/sessionMemory'
import type { Tool } from './tool'

export function createNewSessionTool(session: SessionResetSource): Tool {
  return {
    name: 'new_session',
    requiresHistory: true,
    description:
      'Forget every previous command and answer in this session and start a fresh thread. ' +
      'Call this once, on its own, when the user clearly abandons the earlier topic ' +
      '("forget all that", "never mind all that", "different question"), then handle ' +
      'their new request with no reference to what came before.',
    async execute() {
      session.clear()
      return 'Session cleared: previous commands and answers are gone from this conversation. Treat the current request as the first one.'
    },
  }
}
