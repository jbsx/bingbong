import type { ObservationProducer } from '../session/observationLedger'

// How one tool call lands in an Observation ledger (#111): the single
// classification table shared by the orchestrator's Run ledger and a
// delegated worker's own ledger (#123) — both ground Evidence Checkpoints
// against what the observing agent actually saw, so both must classify
// tool outcomes the same way.

/** How one tool call lands in the Observation ledger (#111). */
export interface ToolObservationClass {
  readonly producer: ObservationProducer
  /**
   * Whether the observation records the observing tab's URL as its
   * source. Page-facing tools observe a page; everything else (panel,
   * settings, app, session, delegation, headline bookkeeping) observes
   * app state.
   */
  readonly pageFacing: boolean
}

/** How a tool that observes a page lands in the ledger. */
const PAGE_OBSERVATION: ToolObservationClass = { producer: 'action_outcome', pageFacing: true }

/**
 * The one classification table (#111): tools whose observations carry a
 * producer kind other than the default or no page source. Unlisted tools
 * fall through to the plain action-outcome class.
 */
const TOOL_OBSERVATION_CLASSES: Readonly<Record<string, ToolObservationClass>> = {
  read_page: { producer: 'page_read', pageFacing: true },
  look: { producer: 'look', pageFacing: true },
  agent_results: { producer: 'subagent_report', pageFacing: false },
  navigate: PAGE_OBSERVATION,
  click: PAGE_OBSERVATION,
  type: PAGE_OBSERVATION,
  scroll: PAGE_OBSERVATION,
  screenshot: PAGE_OBSERVATION,
  back: PAGE_OBSERVATION,
  go_forward: PAGE_OBSERVATION,
  ground_visual: PAGE_OBSERVATION,
  media_control: PAGE_OBSERVATION,
}

const DEFAULT_TOOL_OBSERVATION: ToolObservationClass = { producer: 'action_outcome', pageFacing: false }

export function classifyToolObservation(name: string): ToolObservationClass {
  return TOOL_OBSERVATION_CLASSES[name] ?? DEFAULT_TOOL_OBSERVATION
}
