// The Trace UI's model (#189, ADR 0031): three diagnostic file families —
// the always-on perf log, the Run Trace and the Host Trace — joined on the
// ids each line already carries, into the timelines a developer otherwise
// assembles by hand with `jq`. This is a developer tool's model and
// nothing else: no view in the app imports it, and the files it reads are
// never read back by the app (the property that lets them hold the user's
// own words in the first place).
//
// The join is the boundary rule read backwards. A record was routed to the
// Run Trace because a turn id was in hand, so a turn id is what folds it
// back together with the perf spans of the same turn — and with the few
// Host Trace kinds (`tts_line`, `tts_dropped`) that name a turn without
// having been written inside one. Everything that names no turn is lane'd
// by the Session it names, `null` included: a Host Trace line with no
// Session is the app acting with none live, which is its own lane, not a
// gap. Zero imports beyond types, so the standalone script can load it
// under node's type stripping.

export type TraceFamily = 'perf' | 'run' | 'host'

/**
 * One parsed line as the collector admits it: `at` is the one field every
 * family's record carries and the only one the join sorts on, so it is
 * the one the collector checks. Everything else is read at face value —
 * the files are the contract, and a kind this model does not know still
 * lands in its lane with a generic summary rather than being refused.
 */
export type TraceLine = { readonly at: number } & Record<string, unknown>

/** One parsed line, stamped with the family whose file it came from. */
export interface TaggedTraceRecord {
  readonly family: TraceFamily
  readonly record: TraceLine
}

/** How much of a record's text a one-line summary keeps. */
export const SUMMARY_MAX_CHARS = 160

export interface TimelineEntry {
  readonly at: number
  readonly family: TraceFamily
  /** The perf stage, or the trace record's kind (a `pipeline_event`'s event type). */
  readonly label: string
  /** One line a developer would grep for; the full record is beside it. */
  readonly summary: string
  /** The delegated worker the record came from, when it did (#183, #185). */
  readonly agentId?: string
  /**
   * The failure screenshot's file name (#191), on the `failure_screenshot`
   * entry and on the `done` entry of the same lane — the file is served by
   * name from the logs dir, never by the absolute path the record holds.
   */
  readonly screenshot?: string
  /** The line as parsed, for the expander. */
  readonly record: unknown
}

export interface TurnLane {
  readonly scope: 'turn'
  /** Unique across the timeline: `turn:<turnId>`; the page keys its state on it. */
  readonly key: string
  readonly turnId: string
  /** The first Session and Run the lane's records named, or null when none did. */
  readonly sessionId: string | null
  readonly runId: string | null
  readonly startAt: number
  readonly endAt: number
  readonly entries: readonly TimelineEntry[]
}

export interface SessionLane {
  readonly scope: 'session'
  /** Unique across the timeline: `session:<sessionId>`, `session:` for null. */
  readonly key: string
  /** `null` is the lane for records written with no Session live. */
  readonly sessionId: string | null
  readonly startAt: number
  readonly endAt: number
  readonly entries: readonly TimelineEntry[]
}

export type TimelineLane = TurnLane | SessionLane

export interface TraceTimeline {
  /** Lanes in order of their first record. */
  readonly lanes: readonly TimelineLane[]
  /** How many records each family contributed. */
  readonly counts: Readonly<Record<TraceFamily, number>>
}

type MutableLane =
  | { scope: 'turn'; key: string; turnId: string; sessionId: string | null; runId: string | null; entries: TimelineEntry[] }
  | { scope: 'session'; key: string; sessionId: string | null; entries: TimelineEntry[] }

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function buildTraceTimeline(records: readonly TaggedTraceRecord[]): TraceTimeline {
  const counts: Record<TraceFamily, number> = { perf: 0, run: 0, host: 0 }
  const lanes = new Map<string, MutableLane>()

  for (const tagged of records) {
    counts[tagged.family] += 1
    const raw = tagged.record
    const turnId = stringOrNull(raw.turnId)
    const sessionId = stringOrNull(raw.sessionId)
    const key = turnId !== null ? `turn:${turnId}` : `session:${sessionId ?? ''}`
    let lane = lanes.get(key)
    if (lane === undefined) {
      lane =
        turnId !== null
          ? { scope: 'turn', key, turnId, sessionId, runId: null, entries: [] }
          : { scope: 'session', key, sessionId, entries: [] }
      lanes.set(key, lane)
    }
    if (lane.scope === 'turn') {
      if (lane.sessionId === null) lane.sessionId = sessionId
      if (lane.runId === null) lane.runId = stringOrNull(raw.runId)
    }
    lane.entries.push(entryOf(tagged))
  }

  const built: TimelineLane[] = []
  for (const lane of lanes.values()) {
    // A stable sort: two records at the same millisecond keep write order.
    const sorted = [...lane.entries].sort((a, b) => a.at - b.at)
    // The failure screenshot joins the `done` it was taken for (#191): the
    // record is written after the `done`, so the link lives on both.
    const screenshot = sorted.find((entry) => entry.label === 'failure_screenshot')?.screenshot
    const entries =
      screenshot === undefined
        ? sorted
        : sorted.map((entry) => (entry.label === 'done' && entry.screenshot === undefined ? { ...entry, screenshot } : entry))
    const startAt = entries[0].at
    const endAt = entries[entries.length - 1].at
    built.push(
      lane.scope === 'turn'
        ? { scope: 'turn', key: lane.key, turnId: lane.turnId, sessionId: lane.sessionId, runId: lane.runId, startAt, endAt, entries }
        : { scope: 'session', key: lane.key, sessionId: lane.sessionId, startAt, endAt, entries },
    )
  }
  built.sort((a, b) => a.startAt - b.startAt)
  return { lanes: built, counts }
}

function entryOf(tagged: TaggedTraceRecord): TimelineEntry {
  const raw = tagged.record
  const at = raw.at
  if (tagged.family === 'perf') {
    return { at, family: 'perf', label: String(raw.stage), summary: summarizePerf(raw), record: raw }
  }
  const agentId = stringOrNull(raw.agentId) ?? undefined
  const kind = typeof raw.kind === 'string' ? raw.kind : 'unknown'
  const label = kind === 'pipeline_event' ? eventTypeOf(raw.event) : kind
  const screenshot = kind === 'failure_screenshot' ? fileNameOf(raw.path) : null
  return {
    at,
    family: tagged.family,
    label,
    summary: cut(summarizeTrace(kind, raw)),
    record: raw,
    ...(agentId ? { agentId } : {}),
    ...(screenshot !== null ? { screenshot } : {}),
  }
}

/** The last segment of a path, whichever separator wrote it; null for anything that is not a path. */
function fileNameOf(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') return null
  const name = path.split(/[\\/]/).pop() ?? ''
  return name === '' ? null : name
}

function usageOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const usage = value as Record<string, unknown>
  return `${str(usage.promptTokens)} in / ${str(usage.completionTokens)} out`
}

function modelsOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const models = value as Record<string, unknown>
  return ['orchestrator', 'subagent', 'vision']
    .filter((role) => typeof models[role] === 'string')
    .map((role) => `${role} ${str(models[role])}`)
    .join(', ')
}

function eventTypeOf(event: unknown): string {
  if (typeof event !== 'object' || event === null) return 'pipeline_event'
  const type = (event as Record<string, unknown>).type
  return typeof type === 'string' ? type : 'pipeline_event'
}

function summarizePerf(raw: Record<string, unknown>): string {
  const ms = typeof raw.durMs === 'number' ? `${Math.round(raw.durMs)} ms` : ''
  if (raw.stage === 'summary') return cut(`total ${ms}`)
  const detail = raw.detail
  if (typeof detail === 'object' && detail !== null && Object.keys(detail).length > 0) {
    return cut(`${ms} ${JSON.stringify(detail)}`)
  }
  return ms
}

function cut(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SUMMARY_MAX_CHARS ? `${flat.slice(0, SUMMARY_MAX_CHARS - 1)}…` : flat
}

function str(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.map(str).join(', ') : str(value)
}

/**
 * One vision attempt's milestones (#204), in the order they happen. A
 * milestone that never happened is left out rather than printed as a zero —
 * the gap between `resp` and `byte`, or the absence of both, is what
 * separates a queued provider from a silent one.
 *
 * Only what a glance needs: the line is cut at SUMMARY_MAX_CHARS, so the
 * limits in force and an unremarkable 200 stay in the record for the
 * expander rather than crowding out the milestones and the count.
 */
function attemptOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const attempt = value as Record<string, unknown>
  const at = (label: string, ms: unknown): string => (typeof ms === 'number' ? `${label} ${Math.round(ms)}ms` : '')
  const status = attempt.responseStatus
  return [
    str(attempt.ending),
    at('resp', attempt.responseAtMs),
    typeof status === 'number' && status !== 200 ? `http ${str(status)}` : '',
    at('byte', attempt.firstByteAtMs),
    at('reasoning', attempt.firstReasoningAtMs),
    at('content', attempt.firstContentAtMs),
    at('end', attempt.streamEndAtMs),
    `${str(attempt.progressEvents)}/${str(attempt.streamEvents)} events`,
    typeof attempt.malformedEvents === 'number' && attempt.malformedEvents > 0 ? `${str(attempt.malformedEvents)} malformed` : '',
  ]
    .filter((part) => part !== '')
    .join(', ')
}

function countsOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const counts = value as Record<string, unknown>
  return `${str(counts.observations)} obs / ${str(counts.candidates)} cand / ${str(counts.contradictions)} contra`
}

/** The one line per kind, in the words its ADR uses for the record. */
function summarizeTrace(kind: string, record: Record<string, unknown>): string {
  switch (kind) {
    case 'pipeline_event': {
      // A run_plan record names the models the Run ran under (#191).
      const models = modelsOf(record.models)
      return models === '' ? summarizeEvent(record.event) : `${summarizeEvent(record.event)} [${models}]`
    }
    case 'reasoning':
      return `round ${str(record.round)} attempt ${str(record.attempt)}: ${str(record.text)}`
    case 'llm_round': {
      const request = typeof record.request === 'object' && record.request !== null ? (record.request as Record<string, unknown>) : {}
      return [
        `round ${str(record.round)} attempt ${str(record.attempt)} ${str(record.role)}`,
        record.model !== undefined ? str(record.model) : '',
        record.reasoningEffort !== undefined ? `@${str(record.reasoningEffort)}` : '',
        `${str(request.toolResults)} results / ${str(request.chars)} chars`,
        // How it ended and how much it thought (#218): a cut round says so
        // on the line, next to the reasoning it streamed before the cut.
        record.outcome !== undefined && record.outcome !== 'completed' ? `✗ ${str(record.outcome)}` : '',
        typeof record.reasoningChars === 'number' && record.reasoningChars > 0 ? `thought ${str(record.reasoningChars)} chars` : '',
        record.usage !== undefined ? `→ ${usageOf(record.usage)}` : '',
        record.promptHash !== undefined ? `prompt ${str(record.promptHash)}` : '',
      ]
        .filter((part) => part !== '')
        .join(' ')
    }
    case 'off_contract_reply':
      return `${str(record.role)}${record.agentId !== undefined ? ` ${str(record.agentId)}` : ''} ${str(record.shape)} (${str(record.cause)}): ${str(record.text)}`
    case 'failure_screenshot':
      return `${str(record.cause)}: ${str(fileNameOf(record.path))} (${str(record.bytes)} bytes)`
    case 'evidence_checkpoint':
      return `${str(record.tool)} ${str(record.outcome)}`
    case 'evidence_accepted':
      return `${str(record.change)} ${str(record.entryId)}${record.merged === true ? ' (merged)' : ''}: ${countsOf(record.counts)}`
    case 'evidence_answered':
      return `${str(record.requester)} ${str(record.answered)}${record.counts !== undefined ? `: ${countsOf(record.counts)}` : ''}`
    case 'evidence_broadcast':
      return `to ${Array.isArray(record.renderers) ? record.renderers.join(', ') || 'nobody' : ''}`
    case 'session_evidence_end':
      return `${str(record.reason)}: ${countsOf(record.counts)}`
    case 'fault':
      return `${str(record.site)}: ${str(record.message)}`
    case 'vision_request': {
      // The attempt's milestones read beside the outcome (#204): an eight-second
      // failure says which deadline fired and how far the exchange actually got.
      // They go last, after the failure sentence, because this line is cut at
      // SUMMARY_MAX_CHARS and a full set of milestones outruns it: what a cut
      // costs is then a trailing count, never the message someone grepped for.
      const attempt = attemptOf(record.attempt)
      return `${str(record.capability)} (${str(record.reason)}) ${str(record.outcome)} in ${str(record.durationMs)} ms${record.message !== undefined ? `: ${str(record.message)}` : ''}${attempt === '' ? '' : ` [${attempt}]`}`
    }
    case 'vision_budget':
      return `${str(record.reason)} ${record.granted === true ? 'granted' : `refused: ${str(record.refusal)}`}`
    case 'voice_wake':
      return `${str(record.head)} score ${str(record.score)} ≥ ${str(record.threshold)}, gate ${str(record.gateMax)} ≥ ${str(record.gate)}`
    case 'voice_endpoint':
      return `${str(record.speechMs)} ms speech of ${str(record.totalMs)} ms${record.truncated === true ? ', capped' : ''}${record.reason ? ` (${str(record.reason)})` : ''}`
    case 'voice_stt':
      return record.error !== undefined ? `failed: ${str(record.error)}` : `${str(record.text)} (${str(record.durationMs)} ms)`
    case 'learned_term':
      return `${str(record.source)}: +[${list(record.admitted)}] -[${list(record.removed)}]`
    case 'tts_line':
      return str(record.text)
    case 'tts_dropped':
      return `${str(record.stage)}: ${str(record.text)}`
    case 'feed_cleared':
      return `${str(record.surface)} ${str(record.cause)} (${str(record.entries)} entries)`
    case 'feed_panel':
      return `${str(record.surface)} ${record.open === true ? 'open' : 'closed'} ${str(record.mode)}`
    case 'evidence_rendered':
      return `${str(record.surface)} ${str(record.answered)}: rendered ${countsOf(record.rendered)}${record.received !== undefined ? `, received ${countsOf(record.received)}` : ''}`
    case 'session_readopt':
      return `${str(record.surface)} ${str(record.source)} ${record.adopted === true ? `adopted ${str(record.adoptedSessionId)}` : 'nothing to adopt'}`
    default:
      return ''
  }
}

function summarizeEvent(event: unknown): string {
  if (typeof event !== 'object' || event === null) return ''
  const published = event as Record<string, unknown>
  switch (published.type) {
    case 'command':
    case 'speak':
    case 'display':
    case 'steer':
    case 'run_headline':
      return str(published.text)
    case 'status':
      return str(published.status)
    case 'tool_call':
      return `${str(published.name)} ${str(published.args)}`
    case 'tool_result':
      return published.ok === true ? `${str(published.name)} ok ${str(published.result)}` : `${str(published.name)} failed: ${str(published.error)}`
    case 'error':
      return str(published.message)
    case 'llm_retry':
      return `attempt ${str(published.attempt)} of ${str(published.maxAttempts)}`
    case 'waiting_on_agents':
      return `${str(published.running)} running`
    case 'run_plan':
      return `${str(published.effortTier)} (${str(published.source)}): ${str(published.objective)}`
    case 'confirmation_requested':
      return `${str(published.toolName)}: ${str(published.prompt)}`
    case 'confirmation_resolved':
      return `${published.approved === true ? 'approved' : 'declined'} (${str(published.reason)})`
    case 'ask_requested':
      return str(published.question)
    case 'ask_resolved':
      return `${str(published.answer) || 'no answer'} (${str(published.reason)})`
    case 'agent_update': {
      const agent = typeof published.agent === 'object' && published.agent !== null ? (published.agent as Record<string, unknown>) : {}
      return `${str(agent.kind)} ${str(agent.status)}: ${str(agent.lastAction) || str(agent.task)}`
    }
    case 'subagent_finalized':
      return `${str(published.agentId)} ${str(published.kind)} ${str(published.status)}${published.cause !== undefined ? ` (${str(published.cause)})` : ''}`
    case 'done':
      return [
        str(published.outcome),
        str(published.resolution),
        published.finalizationCause !== undefined ? `(${str(published.finalizationCause)})` : '',
      ]
        .filter((part) => part !== '')
        .join(' ')
    case 'confirmation_deadline':
    case 'ask_deadline':
      return published.expiresAt === null ? 'deadline cleared' : `expires ${str(published.expiresAt)}`
    case 'session_started':
      return `${str(published.sessionId)} generation ${str(published.sessionGeneration)}`
    case 'session_expiring':
    case 'session_extended':
      return `${str(published.sessionId)} until ${str(published.expiresAt)}`
    case 'session_ended':
      return `${str(published.sessionId)} ${str(published.reason)}`
    default:
      return ''
  }
}
