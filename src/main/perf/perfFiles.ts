// The perf-*.jsonl naming contract shared by the rotating sink (writes) and
// the report collector (reads): one definition so the two cannot drift and
// the report silently miss files. Zero imports — safe for the standalone
// perf:report script.

export const PERF_FILE_PATTERN = /^perf-.*\.jsonl$/
