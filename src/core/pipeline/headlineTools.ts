// The Run Headline tool (ADR 0025): the orchestrator reports a one-line
// statement of what the Run is doing now — first response, and again
// whenever understanding changes, a steering correction most of all. The
// call rides alongside the round's real work; the pipeline reads it off
// the round's calls and emits the `run_headline` event the Peek Card's
// live title folds over. The tool itself only acknowledges.

import type { Tool } from './tool'

export function createReportHeadlineTool(): Tool {
  return {
    name: 'report_headline',
    description:
      'Report the current task headline: one short line describing what you are doing for the user right now, ' +
      'in task terms ("Find a blue mug under $20"), never a tool name. Call it alongside your other tool calls ' +
      'in your first response, and again whenever the task changes — especially right after a steering directive ' +
      'corrects it. The user sees it as the run\u2019s live title.',
    parameters: {
      headline: {
        type: 'string',
        description: 'The task as you now understand it — one short line.',
      },
    },
    async execute() {
      return 'Headline noted.'
    },
  }
}
