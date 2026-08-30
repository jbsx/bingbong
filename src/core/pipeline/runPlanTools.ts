// The Run Plan reporting tool (#116, ADR 0025/0027): the orchestrator
// declares the current objective, the model-controlled Run Headline, and
// the smallest sufficient Effort Tier — in the first useful Tool Round,
// and again whenever understanding changes, a steering correction most of
// all. The call rides alongside the round's real work; the pipeline reads
// it off the round's calls, emits the `run_plan`/`run_headline` events,
// and answers the call itself with an acceptance or a corrective notice.

import type { Tool } from './tool'
import { EFFORT_TIERS, effortTierVocabulary } from './runPlan'

export function createReportRunPlanTool(): Tool {
  return {
    name: 'report_run_plan',
    description:
      'Report the Run Plan: objective (the task as you now understand it), headline (one short line in task terms ' +
      '("Find a blue mug under $20"), never a tool name — the run\u2019s live title on screen), and effort_tier — the ' +
      `smallest sufficient tier: ${effortTierVocabulary()}. Call it alongside useful work in your first useful tool ` +
      'round — never as a tool round of its own, which wastes the round — and again whenever the task changes, ' +
      'especially right after a steering directive. An objective that must search for or find content is Lookup work ' +
      'or above: a discover-and-open task on a Direct Action budget runs dry before the honest answer. Later calls ' +
      'update the headline at the same tier or escalate exactly one level with escalation_reason naming the new evidence.',
    parameters: {
      objective: {
        type: 'string',
        description: 'The current objective of the run, as you now understand it.',
      },
      headline: {
        type: 'string',
        description: 'The task as you now understand it — one short line.',
      },
      effort_tier: {
        type: 'string',
        description: 'The smallest tier sufficient for the objective.',
        enum: [...EFFORT_TIERS],
      },
      escalation_reason: {
        type: 'string',
        description: 'Required only when escalating effort_tier: the new evidence that makes more effort necessary.',
        required: false,
      },
    },
    async execute() {
      return 'Run Plan noted.'
    },
  }
}
