import type { SessionGeneration } from './sessionIdentity'

declare const observationIdBrand: unique symbol

/** Stable identity of one observation within its Run's ledger (#111). */
export type ObservationId = string & { readonly [observationIdBrand]: 'ObservationId' }

/**
 * What produced an observation (#111). The seven producers the Run
 * Observation ledger exists for: the run's accepted command, page reads,
 * browser Action Outcomes, Looks, ask_user answers, Steering Directives,
 * and Subagent Reports.
 */
export const OBSERVATION_PRODUCERS = [
  'command',
  'page_read',
  'action_outcome',
  'look',
  'ask_user',
  'steering',
  'subagent_report',
] as const
export type ObservationProducer = (typeof OBSERVATION_PRODUCERS)[number]

/** One application-owned observation in the Run's private Working State. */
export interface ObservationRecord {
  readonly id: ObservationId
  /** Observation time. */
  readonly at: number
  readonly producer: ObservationProducer
  /** Whether the observed operation succeeded. */
  readonly ok: boolean
  /** The original payload as produced — tool result text, user text, directive. */
  readonly payload: unknown
  /** The page URL the observation came from, when applicable. */
  readonly sourceUrl?: string
}

export interface ObservationInput {
  readonly producer: ObservationProducer
  readonly ok: boolean
  readonly payload: unknown
  readonly sourceUrl?: string
}

/**
 * The Run Observation ledger (#111, ADR 0028 groundwork): application-owned
 * Run Working State holding every observation the run makes, so grounding,
 * checkpoint validation, and later deterministic compaction cite stable
 * identities instead of parsing mutable prompt strings. The ledger is
 * created per Run, never shown to the model, and disappears — records
 * included — when its Run ends or its Session generation goes stale.
 */
export interface ObservationLedger {
  /**
   * Appends one observation and returns its record, or null when the
   * ledger is closed or its Session generation is stale — a refused
   * record mints no identity.
   */
  record(input: ObservationInput): ObservationRecord | null
  get(id: ObservationId): ObservationRecord | null
  snapshot(): readonly ObservationRecord[]
  /** Drops every record and refuses all further work; idempotent. */
  close(): void
  readonly closed: boolean
}

export function createObservationLedger(deps: {
  now(): number
  /** The Session generation this Run was admitted under. */
  generation: SessionGeneration
  /**
   * Whether `generation` is still the live Session generation — a ledger
   * from a superseded generation (a Session Reset happened) can never
   * mutate the replacement Run's observations.
   */
  isCurrentGeneration(generation: SessionGeneration): boolean
}): ObservationLedger {
  const records: ObservationRecord[] = []
  let counter = 0
  let closed = false

  const ledger: ObservationLedger = {
    record(input) {
      if (closed || !deps.isCurrentGeneration(deps.generation)) return null
      counter += 1
      const record: ObservationRecord = Object.freeze({
        id: `obs-${counter}` as ObservationId,
        at: deps.now(),
        producer: input.producer,
        ok: input.ok,
        payload: input.payload,
        ...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
      })
      records.push(record)
      return record
    },
    get(id) {
      return records.find((record) => record.id === id) ?? null
    },
    snapshot() {
      return Object.freeze([...records])
    },
    close() {
      closed = true
      records.length = 0
    },
    get closed() {
      return closed
    },
  }
  return ledger
}
