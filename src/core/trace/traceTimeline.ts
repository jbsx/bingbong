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
  /** The line as parsed, for the expander. */
  readonly record: unknown
}

export interface TurnLane {
  readonly scope: 'turn'
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

interface MutableLane {
  scope: 'turn' | 'session'
  turnId: string | null
  sessionId: string | null
  runId: string | null
  entries: TimelineEntry[]
}

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
      lane = { scope: turnId !== null ? 'turn' : 'session', turnId, sessionId, runId: null, entries: [] }
      lanes.set(key, lane)
    }
    if (lane.sessionId === null) lane.sessionId = sessionId
    if (lane.runId === null) lane.runId = stringOrNull(raw.runId)
    lane.entries.push(entryOf(tagged))
  }

  const built: TimelineLane[] = []
  for (const lane of lanes.values()) {
    // A stable sort: two records at the same millisecond keep write order.
    const entries = [...lane.entries].sort((a, b) => a.at - b.at)
    const startAt = entries[0].at
    const endAt = entries[entries.length - 1].at
    built.push(
      lane.scope === 'turn'
        ? { scope: 'turn', turnId: lane.turnId as string, sessionId: lane.sessionId, runId: lane.runId, startAt, endAt, entries }
        : { scope: 'session', sessionId: lane.sessionId, startAt, endAt, entries },
    )
  }
  built.sort((a, b) => a.startAt - b.startAt)
  return { lanes: built, counts }
}

function entryOf(tagged: TaggedTraceRecord): TimelineEntry {
  const raw = tagged.record
  const at = raw.at
  const agentId = stringOrNull(raw.agentId) ?? undefined
  if (tagged.family === 'perf') {
    const stage = String(raw.stage)
    return { at, family: 'perf', label: stage, summary: summarizePerf(raw), record: raw, ...(agentId ? { agentId } : {}) }
  }
  const kind = typeof raw.kind === 'string' ? raw.kind : 'unknown'
  const label = kind === 'pipeline_event' ? eventTypeOf(raw.event) : kind
  return {
    at,
    family: tagged.family,
    label,
    summary: cut(summarizeTrace(kind, raw)),
    record: raw,
    ...(agentId ? { agentId } : {}),
  }
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

function countsOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const c = value as Record<string, unknown>
  return `${str(c.observations)} obs / ${str(c.candidates)} cand / ${str(c.contradictions)} contra`
}

/** The one line per kind, in the words its ADR uses for the record. */
function summarizeTrace(kind: string, r: Record<string, unknown>): string {
  switch (kind) {
    case 'pipeline_event':
      return summarizeEvent(r.event)
    case 'reasoning':
      return `round ${str(r.round)} attempt ${str(r.attempt)}: ${str(r.text)}`
    case 'evidence_checkpoint':
      return `${str(r.tool)} ${str(r.outcome)}`
    case 'evidence_accepted':
      return `${str(r.change)} ${str(r.entryId)}${r.merged === true ? ' (merged)' : ''}: ${countsOf(r.counts)}`
    case 'evidence_answered':
      return `${str(r.requester)} ${str(r.answered)}${r.counts !== undefined ? `: ${countsOf(r.counts)}` : ''}`
    case 'evidence_broadcast':
      return `to ${Array.isArray(r.renderers) ? r.renderers.join(', ') || 'nobody' : ''}`
    case 'session_evidence_end':
      return `${str(r.reason)}: ${countsOf(r.counts)}`
    case 'fault':
      return `${str(r.site)}: ${str(r.message)}`
    case 'vision_request':
      return `${str(r.capability)} (${str(r.reason)}) ${str(r.outcome)} in ${str(r.durationMs)} ms${r.message !== undefined ? `: ${str(r.message)}` : ''}`
    case 'vision_budget':
      return `${str(r.reason)} ${r.granted === true ? 'granted' : `refused: ${str(r.refusal)}`}`
    case 'voice_wake':
      return `${str(r.head)} score ${str(r.score)} ≥ ${str(r.threshold)}, gate ${str(r.gateMax)} ≥ ${str(r.gate)}`
    case 'voice_endpoint':
      return `${str(r.speechMs)} ms speech of ${str(r.totalMs)} ms${r.truncated === true ? ', capped' : ''}${r.reason ? ` (${str(r.reason)})` : ''}`
    case 'voice_stt':
      return r.error !== undefined ? `failed: ${str(r.error)}` : `${str(r.text)} (${str(r.durationMs)} ms)`
    case 'learned_term':
      return `${str(r.source)}: +${str(r.admitted)} -${str(r.removed)}`
    case 'tts_line':
      return str(r.text)
    case 'tts_dropped':
      return `${str(r.stage)}: ${str(r.text)}`
    case 'feed_cleared':
      return `${str(r.surface)} ${str(r.cause)} (${str(r.entries)} entries)`
    case 'feed_panel':
      return `${str(r.surface)} ${r.open === true ? 'open' : 'closed'} ${str(r.mode)}`
    case 'evidence_rendered':
      return `${str(r.surface)} ${str(r.answered)}: rendered ${countsOf(r.rendered)}${r.received !== undefined ? `, received ${countsOf(r.received)}` : ''}`
    case 'session_readopt':
      return `${str(r.surface)} ${str(r.source)} ${r.adopted === true ? `adopted ${str(r.adoptedSessionId)}` : 'nothing to adopt'}`
    default:
      return ''
  }
}

function summarizeEvent(event: unknown): string {
  if (typeof event !== 'object' || event === null) return ''
  const e = event as Record<string, unknown>
  switch (e.type) {
    case 'command':
    case 'speak':
    case 'display':
    case 'steer':
    case 'run_headline':
      return str(e.text)
    case 'status':
      return str(e.status)
    case 'tool_call':
      return `${str(e.name)} ${str(e.args)}`
    case 'tool_result':
      return e.ok === true ? `${str(e.name)} ok ${str(e.result)}` : `${str(e.name)} failed: ${str(e.error)}`
    case 'error':
      return str(e.message)
    case 'llm_retry':
      return `attempt ${str(e.attempt)} of ${str(e.maxAttempts)}`
    case 'waiting_on_agents':
      return `${str(e.running)} running`
    case 'run_plan':
      return `${str(e.effortTier)} (${str(e.source)}): ${str(e.objective)}`
    case 'confirmation_requested':
      return `${str(e.toolName)}: ${str(e.prompt)}`
    case 'confirmation_resolved':
      return `${e.approved === true ? 'approved' : 'declined'} (${str(e.reason)})`
    case 'ask_requested':
      return str(e.question)
    case 'ask_resolved':
      return `${str(e.answer) || 'no answer'} (${str(e.reason)})`
    case 'agent_update': {
      const agent = typeof e.agent === 'object' && e.agent !== null ? (e.agent as Record<string, unknown>) : {}
      return `${str(agent.kind)} ${str(agent.status)}: ${str(agent.lastAction) || str(agent.task)}`
    }
    case 'subagent_finalized':
      return `${str(e.agentId)} ${str(e.kind)} ${str(e.status)}${e.cause !== undefined ? ` (${str(e.cause)})` : ''}`
    case 'session_ended':
      return str(e.reason)
    default:
      return ''
  }
}
