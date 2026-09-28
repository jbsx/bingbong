// The checkpoint tool names, held once (#294): the tools that record an
// Evidence Checkpoint or a Candidate decision, as the catalog flags them
// `checkpoint: true` — a test pins the two together. The rails and the Round
// Audit read a call by its name, where no catalog is at hand; they derive
// their own lists from this one. No imports, so the Round Audit loads it
// under plain Node's type stripping.

const CHECKPOINT_TOOLS = ['record_evidence', 'record_candidate'] as const

export type CheckpointToolName = (typeof CHECKPOINT_TOOLS)[number]

export const CHECKPOINT_TOOL_NAMES: ReadonlySet<string> = new Set(CHECKPOINT_TOOLS)
