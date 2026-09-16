// The one line agent_results puts above each Subagent's entry, and the
// question the no-progress rail asks of the tool's reply (#256, ADR 0056):
// did this call collect a Subagent Report? The rail sees only the reply
// text, and agent_results answers `ok` for a listing of running agents, for
// "no uncollected subagent reports" and for "no subagents have been spawned
// yet" — none of which gives a bookkeeping round anything to record. Keeping
// the header's shape and its reader together is what lets the rail read it.

/** The header above one Subagent's entry in an agent_results reply. */
export function agentResultsHeader(id: string, kindLabel: string, status: string, task: string): string {
  return `${id} [${kindLabel}] ${status} — ${task}`
}

const COLLECTED_REPORT_HEADER = /^\S+ \[[^\]]*\] completed — /m

/** Whether an agent_results reply carries at least one collected Subagent Report. */
export function collectedReportIn(result: unknown): boolean {
  return typeof result === 'string' && COLLECTED_REPORT_HEADER.test(result)
}
