// The perf-*.jsonl naming contract shared by the rotating sink (writes) and
// the report collector (reads): one definition so the two cannot drift and
// the report silently miss files. Zero imports — safe for the standalone
// perf:report script.

export const PERF_FILE_PATTERN = /^perf-.*\.jsonl$/
/** The decision-*.jsonl family beside it (#324): one record per Command, and its Misfire signals. */
export const DECISION_FILE_PATTERN = /^decision-.*\.jsonl$/
