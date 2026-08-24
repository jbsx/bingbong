// Model-invoked Session Reset (spec #85, #99): the orchestrator decides a
// command like "bing bong, forget all that — different question" starts a
// fresh Session. The tool itself only acknowledges: the pipeline treats a
// successful call as the isolation boundary — sibling calls from the same
// response never execute and the run reports outcome 'reset' — and the
// command runner ends the old Session (reason 'reset') and restarts the
// original command as fresh work under a new identity.

import type { Tool } from './tool'

export function createNewSessionTool(): Tool {
  return {
    name: 'new_session',
    requiresHistory: true,
    sessionReset: true,
    description:
      'Forget every previous command and answer in this session and start a fresh thread. ' +
      'Call this once, on its own, when the user clearly abandons the earlier topic ' +
      '("forget all that", "never mind all that", "different question"), then handle ' +
      'their new request with no reference to what came before.',
    async execute() {
      return 'Session cleared: previous commands and answers are gone from this conversation. Treat the current request as the first one.'
    },
  }
}
