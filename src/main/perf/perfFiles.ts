// The perf-*.jsonl naming contract shared by the rotating sink (writes) and
// the report collector (reads): one definition so the two cannot drift and
// the report silently miss files. Zero imports — safe for the standalone
// perf:report script.

export const PERF_FILE_PATTERN = /^perf-.*\.jsonl$/
/** The decision-*.jsonl family beside it (#324): one record per Command, and its Misfire signals. */
export const DECISION_FILE_PATTERN = /^decision-.*\.jsonl$/
/** The asks-*.jsonl sidecar beside that (#338): every Jev call's whole ask, which a decision record names. */
export const ASK_FILE_PATTERN = /^asks-.*\.jsonl$/
