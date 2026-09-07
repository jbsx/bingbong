import type { Clock } from '../ports/clock'
import type {
  RunId,
  SessionGeneration,
  SessionId,
  SessionIdentitySource,
  SubmissionId,
} from './sessionIdentity'
import { MAX_RUN_NOTE_CHARS, runStopChars, type RunJournalEntry, type RunJournalSnapshot, type RunStopRecord } from './runJournal'
import {
  createSessionEvidence,
  EMPTY_EVIDENCE_COUNTS,
  type SessionEvidenceCounts,
  type SessionEvidenceSnapshot,
  type SessionEvidenceStore,
} from './sessionEvidence'
import {
  applyMemoryPatch,
  estimateWorkingMemoryTokens,
  currentUserObjective,
  freezeWorkingMemory,
  hasUserAuthority,
  isDuplicateMemoryAddition,
  isLowPriorityMemoryAddition,
  isValidWorkingMemory,
  MAX_MEMORY_DETAIL_CHARS,
  MAX_MEMORY_REFERENCES,
  type MemoryEntry,
  type MemoryEntryId,
  type MemoryPatch,
  type MemoryPatchGrounding,
  type WorkingMemorySnapshot,
} from './workingMemory'

import type { RetainedInspectionReference } from './inspectionReference'
import type { RetainedUserCorrection } from './userCorrections'

export type { RunJournalEntry, RunJournalSnapshot, RunStopRecord } from './runJournal'
export type { MemoryEntry, MemoryPatch, WorkingMemorySnapshot } from './workingMemory'
export type { InspectionSubject, RetainedInspectionReference } from './inspectionReference'
export type { RetainedUserCorrection, UserCorrectionSubject } from './userCorrections'
export type {
  SessionCandidate,
  SessionEvidenceCounts,
  SessionEvidenceSnapshot,
  SessionEvidenceStore,
  SessionObservation,
} from './sessionEvidence'
import { reportFault } from '../trace/fault'

export type { SessionGeneration } from './sessionIdentity'

export type SessionPhase = 'absent' | 'active' | 'expiring'
export type SessionEndReason = 'lapsed' | 'reset' | 'app_closed' | 'interrupted'

/**
 * A Session stays open while the gap after the latest accepted Run's finish
 * is shorter than this window: 30 minutes (ADR 0005 widened ADR 0001's
 * original 10; ADR 0014 owns the semantics now).
 */
export const SESSION_WINDOW_MS = 30 * 60 * 1000

export interface Submission {
  submissionId: SubmissionId
  submittedAt: number
}

export interface AcceptedRunAdmission {
  accepted: true
  submissionId: SubmissionId
  runId: RunId
  sessionId: SessionId
  generation: SessionGeneration
  acceptedAt: number
  createsSession: boolean
  journal: RunJournalSnapshot
  memory: WorkingMemorySnapshot
  /** Checkpointed Session Evidence the accepted Run starts beside its Memory Entries (#112). */
  evidence: SessionEvidenceSnapshot
  /**
   * The Inspection Reference the Session retained (#210, ADR 0039): the
   * Candidate a previous Answer presented, which this Run's inspection
   * commands address. Absent when the Session holds no subject.
   */
  inspection?: RetainedInspectionReference
  /**
   * The user's own words this Session retains and no Run has resolved
   * (#211, ADR 0039), this Run's own utterance included. Retained before
   * the Run makes a single model request, so a first-request failure
   * leaves the correction standing rather than erasing it. Absent when
   * the Session holds nothing unresolved.
   */
  corrections?: readonly RetainedUserCorrection[]
}

export interface SessionRuntimeState {
  phase: SessionPhase
  sessionId: SessionId | null
  generation: SessionGeneration
  startedAt: number | null
  acceptedRunIds: readonly RunId[]
  liveRunIds: readonly RunId[]
}

export interface EndedSession {
  sessionId: SessionId
  generation: SessionGeneration
  reason: SessionEndReason
  startedAt: number
  endedAt: number
  acceptedRunIds: readonly RunId[]
  liveRunIds: readonly RunId[]
  /**
   * What Session Evidence held at the end (#181), read before the store
   * is cleared — `onEnded` fires after the clear, so this is the only
   * place the final counts still exist.
   */
  evidence: SessionEvidenceCounts
}

export interface ExpiringSession {
  sessionId: SessionId
  generation: SessionGeneration
  at: number
  expiresAt: number
}

export type ExtendedSession = ExpiringSession

export interface SessionDecision {
  sessionId: SessionId
  generation: SessionGeneration
}

/**
 * An accepted Observation change in the live Session's evidence (#139):
 * the identity renderers must match before they read the authoritative
 * snapshot — work of a foreign or superseded Session is discardable.
 */
export interface SessionEvidenceChange {
  sessionId: SessionId
  generation: SessionGeneration
}

/**
 * A retained evidence change with the detail the renderers are
 * deliberately not told (#181): what the store held afterwards, whether
 * the checkpoint merged rather than added, and what it contradicts. The
 * change signal stays identity-only — this rides beside it, for the Run
 * Trace alone, and is never sent to a view.
 */
export interface SessionEvidenceAcceptance extends SessionEvidenceChange {
  /** Which retained change fired it: an Observation checkpoint or a Candidate change. */
  change: 'observation' | 'candidate'
  entryId: MemoryEntryId
  counts: SessionEvidenceCounts
  merged: boolean
  contradicted: readonly MemoryEntryId[]
}

export interface ContinuityTokenThresholds {
  high: number
  reserve: number
  hard: number
}

export interface SessionContinuityBudgets {
  journal: ContinuityTokenThresholds
  memory: ContinuityTokenThresholds
}

export interface ContinuityCompactionRequest {
  model: string
  journal: RunJournalSnapshot
  memory: WorkingMemorySnapshot
  targetTokens: Readonly<{ journal: number; memory: number }>
}

export interface ContinuityCompaction {
  journal: RunJournalSnapshot
  memory: WorkingMemorySnapshot
}

export type ContinuityDegradationReason =
  | 'compaction_invalid'
  | 'compaction_timeout'
  | 'compaction_failed'
  | 'compaction_stale'
  | 'reserve_addition_rejected'
  | 'hard_journal_omission'
  | 'hard_memory_rejection'
  | 'budget_profile_invalid'

export interface ContinuityDegradation {
  reason: ContinuityDegradationReason
  model: string
  at: number
}

/**
 * Parses `BINGBONG_CONTINUITY_BUDGETS`. Total: malformed input warns and
 * falls back to undefined (default budgets) — bad env JSON never blocks boot.
 */
export function parseSessionContinuityBudgets(value: string | undefined): Record<string, SessionContinuityBudgets> | undefined {
  if (value === undefined || value.trim() === '') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('must be a JSON object keyed by model')
    }
    return parsed as Record<string, SessionContinuityBudgets>
  } catch (err) {
    console.warn(`[continuity] ignoring malformed BINGBONG_CONTINUITY_BUDGETS: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

export interface SessionRuntime {
  state(): SessionRuntimeState
  submit(): Submission
  /**
   * Admits one submission as a Run. `utterance` is the user's exact
   * command: on a continuation it is retained verbatim as an unresolved
   * correction before the Run starts (#211, ADR 0039) — a rejected
   * submission is not an accepted Run and retains nothing.
   */
  accept(submissionId: SubmissionId, utterance?: string): AcceptedRunAdmission
  reject(submissionId: SubmissionId): boolean
  finish(runId: RunId): boolean
  /** The live Session's evidence store, or null while no Session exists (#112). */
  evidenceStore(): SessionEvidenceStore | null
  commitRunContinuity(
    runId: RunId,
    outcome: RunJournalEntry['outcome'],
    text: string,
    patch: MemoryPatch,
    /** Why this Run stopped (#203), when it retained something worth explaining later. */
    stop?: RunStopRecord | null,
  ): 'committed' | 'invalid_patch' | 'rejected'
  extend(decision: SessionDecision): boolean
  decline(decision: SessionDecision): EndedSession | null
  end(reason: SessionEndReason): EndedSession | null
  dispose(): void
}

export function createSessionRuntime(deps: {
  clock: Clock
  identities: SessionIdentitySource
  sessionWindowMs?: number
  warningLeadMs?: number
  onExpiring?: (session: ExpiringSession) => void
  onExtended?: (session: ExtendedSession) => void
  onEnded?: (session: EndedSession) => void
  /**
   * An Observation was checkpointed into the live Session's evidence —
   * accepted or exact-duplicate merged (#139). Fired with the Session's
   * identity and generation so Session-bearing renderers can re-read the
   * authoritative snapshot and discard foreign work.
   */
  onEvidenceChanged?: (change: SessionEvidenceChange) => void
  /**
   * The same retained change, with the store detail no view is given
   * (#181): the Run Trace's record of what actually reached the store.
   * Fired for every retained Observation or Candidate change, from the
   * same observers as the change signal, so the trace and the broadcast
   * can never disagree about which changes happened.
   */
  onEvidenceAccepted?: (acceptance: SessionEvidenceAcceptance) => void
  continuityModel?: string | (() => string)
  continuityBudgets?: Readonly<Record<string, SessionContinuityBudgets>>
  compactContinuity?: (request: ContinuityCompactionRequest) => Promise<ContinuityCompaction>
  compactionTimeoutMs?: number
  recentJournalEntries?: number
  recentMemoryEntries?: number
  onContinuityDegraded?: (degradation: ContinuityDegradation) => void
}): SessionRuntime {
  if (deps.sessionWindowMs !== undefined) {
    if (!Number.isFinite(deps.sessionWindowMs) || deps.sessionWindowMs <= 0) {
      throw new Error('sessionWindowMs must be positive')
    }
    if (deps.warningLeadMs === undefined || !Number.isFinite(deps.warningLeadMs) || deps.warningLeadMs <= 0) {
      throw new Error('warningLeadMs must be positive when sessionWindowMs is configured')
    }
    if (deps.warningLeadMs >= deps.sessionWindowMs) {
      throw new Error('warningLeadMs must be shorter than sessionWindowMs')
    }
  }
  /**
   * The default continuity budgets (ADR 0014): derived from the original
   * char ceilings (12k Journal / 24k Working Memory at ~4 chars per token)
   * with the 80/90/100% high/reserve/hard split. A model-specific profile
   * in `continuityBudgets` replaces them wholesale.
   */
  const fallbackBudgets: SessionContinuityBudgets = {
    journal: { high: 2_400, reserve: 2_700, hard: 3_000 },
    memory: { high: 4_800, reserve: 5_400, hard: 6_000 },
  }
  const validateThresholds = (name: string, value: ContinuityTokenThresholds): void => {
    if (
      !Number.isFinite(value.high) || !Number.isFinite(value.reserve) || !Number.isFinite(value.hard) ||
      value.high <= 0 || value.high >= value.reserve || value.reserve >= value.hard
    ) throw new Error(`${name} token thresholds must be positive and ordered high < reserve < hard`)
  }
  const resolveModel = (): string => {
    const configured = typeof deps.continuityModel === 'function' ? deps.continuityModel() : deps.continuityModel
    return configured?.trim() || 'default'
  }
  const resolveBudgets = (selectedModel: string): SessionContinuityBudgets => {
    const selected = deps.continuityBudgets
      ? deps.continuityBudgets[selectedModel] ?? deps.continuityBudgets['*']
      : fallbackBudgets
    if (!selected) throw new Error(`No continuity token budget configured for model: ${selectedModel}`)
    validateThresholds('Journal', selected.journal)
    validateThresholds('Working Memory', selected.memory)
    return selected
  }
  const degrade = (reason: ContinuityDegradationReason): void => {
    try {
      ;(deps.onContinuityDegraded ?? ((event) => console.warn(`[continuity] ${event.reason} for ${event.model}`)))({
        reason,
        model,
        at: deps.clock.now(),
      })
    } catch (error) {
      reportFault('session.sessionRuntime.degrade', error)
      // Continuity diagnostics are maintenance-only and cannot fail a Run.
    }
  }
  let model = 'default'
  let continuityBudgets = fallbackBudgets
  try {
    model = resolveModel()
    continuityBudgets = resolveBudgets(model)
  } catch (error) {
    reportFault('session.sessionRuntime.resolveProfile', error)
    model = 'default'
    continuityBudgets = fallbackBudgets
    degrade('budget_profile_invalid')
  }
  const compactionTimeoutMs = deps.compactionTimeoutMs ?? 10_000
  if (!Number.isFinite(compactionTimeoutMs) || compactionTimeoutMs <= 0) {
    throw new Error('compactionTimeoutMs must be positive')
  }
  const recentJournalEntries = deps.recentJournalEntries ?? 2
  const recentMemoryEntries = deps.recentMemoryEntries ?? 3
  if (!Number.isInteger(recentJournalEntries) || recentJournalEntries < 0) {
    throw new Error('recentJournalEntries must be a non-negative integer')
  }
  if (!Number.isInteger(recentMemoryEntries) || recentMemoryEntries < 0) {
    throw new Error('recentMemoryEntries must be a non-negative integer')
  }
  let phase: SessionPhase = 'absent'
  let sessionId: SessionId | null = null
  let generation = 0
  let startedAt: number | null = null
  let acceptedRunIds: RunId[] = []
  const reportEvidence = deps.onEvidenceChanged
  const reportAcceptance = deps.onEvidenceAccepted
  const noEvidenceObservers = reportEvidence === undefined && reportAcceptance === undefined
  const liveRunIds = new Set<RunId>()
  const pendingSubmissionIds = new Set<SubmissionId>()
  let journal: RunJournalEntry[] = []
  let memory: MemoryEntry[] = []
  let evidence: SessionEvidenceStore | null = null
  let nextMemoryId = 1
  const committedRunIds = new Set<RunId>()
  let cancelWarning: (() => void) | null = null
  let cancelDeadline: (() => void) | null = null
  let deadlineAt: number | null = null
  let continuityRevision = 0
  let aboveHighWater = false
  let compactionEpoch = 0
  let cancelCompactionTimeout: (() => void) | null = null

  const refreshContinuityProfile = (): void => {
    let selectedModel: string
    let selectedBudgets: SessionContinuityBudgets
    try {
      selectedModel = resolveModel()
      if (selectedModel === model) return
      selectedBudgets = resolveBudgets(selectedModel)
    } catch (error) {
      reportFault('session.sessionRuntime.refreshContinuityProfile', error)
      degrade('budget_profile_invalid')
      return
    }
    model = selectedModel
    continuityBudgets = selectedBudgets
    aboveHighWater = false
  }

  // The Run Note plus the stop record that rides beside it (#203): the
  // wire client serializes whole entries, so anything this measure omits
  // reaches the model outside the Journal's own watermarks.
  const journalTokens = (entries: readonly RunJournalEntry[]): number =>
    Math.ceil(entries.reduce((total, entry) => total + entry.text.length + runStopChars(entry.stop), 0) / 4)

  const isAboveHighWater = (): boolean =>
    journalTokens(journal) > continuityBudgets.journal.high ||
    estimateWorkingMemoryTokens(memory) > continuityBudgets.memory.high

  const includesEntry = <T>(candidate: readonly T[], protectedEntry: T): boolean =>
    candidate.some((entry) => JSON.stringify(entry) === JSON.stringify(protectedEntry))

  const exactKey = (value: unknown): string => JSON.stringify(value)

  const compactsOldestFirst = <T>(original: readonly T[], candidate: readonly T[], eligible: (entry: T, index: number) => boolean): boolean => {
    const eligibleEntries = original
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => eligible(entry, index))
    const changed = eligibleEntries.map(({ entry }) => !includesEntry(candidate, entry))
    const firstUnchanged = changed.indexOf(false)
    return firstUnchanged === -1 || changed.slice(firstUnchanged).every((entryChanged) => !entryChanged)
  }

  const preservesIdentityOrder = <T>(
    original: readonly T[],
    candidate: readonly T[],
    identity: (entry: T) => string,
  ): boolean => {
    if (candidate.length > original.length) return false
    const originalPositions = new Map(original.map((entry, index) => [identity(entry), index]))
    const seen = new Set<string>()
    let previousOriginalIndex = -1
    for (const entry of candidate) {
      const entryIdentity = identity(entry)
      const originalIndex = originalPositions.get(entryIdentity)
      if (originalIndex === undefined || seen.has(entryIdentity) || originalIndex <= previousOriginalIndex) return false
      seen.add(entryIdentity)
      previousOriginalIndex = originalIndex
    }
    return true
  }

  const compactionIsValid = (
    candidate: ContinuityCompaction,
    expectedSessionId: SessionId,
    originalJournal: RunJournalSnapshot,
    originalMemory: WorkingMemorySnapshot,
    requestBudgets: SessionContinuityBudgets,
  ): boolean => {
    if (!Array.isArray(candidate.journal) || !Array.isArray(candidate.memory)) return false
    const journalByRunId = new Map(originalJournal.map((entry) => [entry.runId, entry]))
    // The retained stop record is the runtime's, not the compactor's
    // (#203): a compaction condenses Run Notes, and whether it echoes,
    // drops, or invents a `stop` changes nothing — the field is stripped
    // for every structural check here and restored from the original when
    // the compaction lands. So the model can neither lose nor rewrite why
    // a Run stopped. The budget below is measured on what will actually
    // be stored — the candidate's Run Notes carrying the original stops —
    // rather than on a `stop` the runtime is about to discard.
    const withoutStop = (entries: RunJournalSnapshot): readonly Omit<RunJournalEntry, 'stop'>[] =>
      entries.map(({ stop: _stop, ...rest }) => rest)
    const originalJournalEntries = withoutStop(originalJournal)
    const candidateJournalEntries = withoutStop(candidate.journal)
    const asStored = (entries: readonly Omit<RunJournalEntry, 'stop'>[]): readonly RunJournalEntry[] =>
      entries.map((entry) => {
        const retained = journalByRunId.get(entry.runId)?.stop
        return { ...entry, ...(retained !== undefined ? { stop: retained } : {}) }
      })
    if (
      journalTokens(asStored(candidateJournalEntries)) > requestBudgets.journal.high ||
      !isValidWorkingMemory(candidate.memory, expectedSessionId, requestBudgets.memory.high)
    ) return false
    const memoryIds = new Set(originalMemory.map(({ id }) => id))
    if (candidate.journal.some((entry) => (
      typeof entry.runId !== 'string' ||
      !journalByRunId.has(entry.runId) ||
      journalByRunId.get(entry.runId)!.outcome !== entry.outcome ||
      !['done', 'failed', 'cancelled'].includes(entry.outcome) ||
      typeof entry.text !== 'string' || entry.text.trim() === '' || entry.text.length > MAX_RUN_NOTE_CHARS
    ))) return false
    if (candidate.memory.some(({ id }) => !memoryIds.has(id))) return false
    if (
      !preservesIdentityOrder(originalJournalEntries, candidateJournalEntries, ({ runId }) => runId) ||
      !preservesIdentityOrder(originalMemory, candidate.memory, ({ id }) => id)
    ) return false

    const protectedJournal = originalJournalEntries.filter((entry, index) =>
      entry.outcome === 'failed' || index >= originalJournalEntries.length - recentJournalEntries,
    )
    const protectedMemory = originalMemory.filter((entry, index) =>
      index >= originalMemory.length - recentMemoryEntries || entry.kind !== 'finding',
    )
    if (
      protectedJournal.some((entry) => !includesEntry(candidateJournalEntries, entry)) ||
      protectedMemory.some((entry) => !includesEntry(candidate.memory, entry))
    ) return false
    if (!compactsOldestFirst(
      originalJournalEntries,
      candidateJournalEntries,
      (entry, index) => entry.outcome !== 'failed' && index < originalJournalEntries.length - recentJournalEntries,
    )) return false
    if (!compactsOldestFirst(
      originalMemory,
      candidate.memory,
      (entry, index) => entry.kind === 'finding' && index < originalMemory.length - recentMemoryEntries,
    )) return false

    const candidateMemory = candidate.memory as WorkingMemorySnapshot
    const originalReferences = new Set(originalMemory.flatMap((entry) => entry.references.map(exactKey)))
    const originalProvenance = new Set(originalMemory.flatMap((entry) => entry.provenance.map(exactKey)))
    if (candidateMemory.some((entry) =>
      entry.references.some((reference) => !originalReferences.has(exactKey(reference))) ||
      entry.provenance.some((source) => !originalProvenance.has(exactKey(source))),
    )) return false
    return originalMemory.every((entry) => {
      const sameIdentity = candidateMemory.find(({ id }) => id === entry.id)
      const possibleContainers = sameIdentity ? [sameIdentity] : candidateMemory
      return possibleContainers.some((compacted) => {
        const references = new Set(compacted.references.map(exactKey))
        const provenance = new Set(compacted.provenance.map(exactKey))
        return entry.references.every((reference) => references.has(exactKey(reference))) &&
          entry.provenance.every((source) => provenance.has(exactKey(source)))
      })
    })
  }

  const defaultCompaction = async (request: ContinuityCompactionRequest): Promise<ContinuityCompaction> => {
    const kept = [...request.journal]
    while (journalTokens(kept) > request.targetTokens.journal && kept.length > recentJournalEntries) {
      const first = kept.findIndex((entry, index) =>
        index < kept.length - recentJournalEntries && entry.outcome !== 'failed',
      )
      const second = kept.findIndex((entry, index) =>
        index > first && index < kept.length - recentJournalEntries && entry.outcome !== 'failed',
      )
      if (first === -1 || second === -1) break
      const left = kept[first]!
      const right = kept[second]!
      const excerptChars = Math.max(40, Math.floor((MAX_RUN_NOTE_CHARS - 80) / 2))
      const text = `Milestone from earlier Runs: [${left.outcome}] ${left.text.slice(0, excerptChars)} | [${right.outcome}] ${right.text.slice(0, excerptChars)}`
      if (text.length >= left.text.length + right.text.length) break
      kept[first] = { runId: left.runId, outcome: left.outcome, text }
      kept.splice(second, 1)
    }
    const compactedMemory = request.memory.map((entry) => ({
      ...entry,
      references: [...entry.references],
      provenance: [...entry.provenance],
    }))
    while (estimateWorkingMemoryTokens(compactedMemory) > request.targetTokens.memory) {
      const eligibleEnd = Math.max(0, compactedMemory.length - recentMemoryEntries)
      const first = compactedMemory.findIndex((entry, index) => index < eligibleEnd && entry.kind === 'finding')
      const second = compactedMemory.findIndex((entry, index) =>
        index > first && index < eligibleEnd && entry.kind === 'finding',
      )
      if (first === -1 || second === -1) break
      const left = compactedMemory[first]!
      const right = compactedMemory[second]!
      const detail = `${left.subject}: ${left.detail}\n${right.subject}: ${right.detail}`
      const references = new Map([...left.references, ...right.references].map((reference) => [reference.url, reference]))
      if (detail.length > MAX_MEMORY_DETAIL_CHARS || references.size > MAX_MEMORY_REFERENCES) break
      const provenance = new Map(
        [...left.provenance, ...right.provenance]
          .map((source) => [`${source.runId}:${source.subagentId ?? ''}`, source]),
      )
      compactedMemory[first] = {
        id: left.id,
        sessionId: left.sessionId,
        kind: 'finding',
        subject: 'Compacted findings',
        detail,
        status: 'compacted',
        references: [...references.values()],
        provenance: [...provenance.values()],
      }
      compactedMemory.splice(second, 1)
    }
    return { journal: kept, memory: compactedMemory }
  }

  const startCompaction = (): void => {
    if (sessionId === null) return
    const compact = deps.compactContinuity ?? defaultCompaction
    const requestRevision = continuityRevision
    const requestSessionId = sessionId
    const requestJournal = journalSnapshot()
    const requestMemory = memorySnapshot()
    const requestBudgets = continuityBudgets
    const epoch = ++compactionEpoch
    let settled = false
    const finishCompaction = (): void => {
      settled = true
      cancelCompactionTimeout?.()
      cancelCompactionTimeout = null
    }
    try {
      cancelCompactionTimeout = deps.clock.setTimer(compactionTimeoutMs, () => {
        if (settled || epoch !== compactionEpoch) return
        settled = true
        cancelCompactionTimeout = null
        degrade('compaction_timeout')
      })
    } catch (error) {
      reportFault('session.sessionRuntime.scheduleCompaction', error)
      degrade('compaction_failed')
      return
    }
    let operation: Promise<ContinuityCompaction>
    try {
      operation = Promise.resolve(compact({
        model,
        journal: requestJournal,
        memory: requestMemory,
        targetTokens: Object.freeze({
          journal: requestBudgets.journal.high,
          memory: requestBudgets.memory.high,
        }),
      }))
    } catch (error) {
      reportFault('session.sessionRuntime.startCompaction', error)
      finishCompaction()
      degrade('compaction_failed')
      return
    }
    void operation.then((candidate) => {
      if (settled || epoch !== compactionEpoch) return
      if (sessionId !== requestSessionId || continuityRevision !== requestRevision) {
        finishCompaction()
        degrade('compaction_stale')
        return
      }
      if (!compactionIsValid(candidate, requestSessionId, requestJournal, requestMemory, requestBudgets)) {
        finishCompaction()
        degrade('compaction_invalid')
        return
      }
      const retainedStops = new Map(requestJournal.map((entry) => [entry.runId, entry.stop]))
      // The compactor rewrites the Run Note; the stop record is restored
      // from the Run that recorded it (#203).
      const compactedJournal = candidate.journal.map(({ stop: _stop, ...entry }) => {
        const retained = retainedStops.get(entry.runId)
        return { ...entry, ...(retained !== undefined ? { stop: retained } : {}) }
      })
      const compactedMemory = candidate.memory.map((entry) => ({
        ...entry,
        references: [...entry.references],
        provenance: [...entry.provenance],
      }))
      finishCompaction()
      journal = compactedJournal
      memory = compactedMemory
      continuityRevision += 1
      aboveHighWater = isAboveHighWater()
    }).catch(() => {
      if (settled || epoch !== compactionEpoch) return
      finishCompaction()
      degrade('compaction_failed')
    })
  }

  const cancelExpiry = (): void => {
    cancelWarning?.()
    cancelDeadline?.()
    cancelWarning = null
    cancelDeadline = null
    deadlineAt = null
  }

  /** What the live store holds, or nothing where no Session has one. */
  const evidenceCounts = (): SessionEvidenceCounts =>
    evidence?.counts() ?? EMPTY_EVIDENCE_COUNTS

  const endSession = (reason: SessionEndReason): EndedSession | null => {
    if (phase === 'absent' || sessionId === null || startedAt === null) return null
    if (reason === 'lapsed' && (phase !== 'expiring' || liveRunIds.size > 0)) return null

    cancelExpiry()
    const ended: EndedSession = {
      sessionId,
      generation,
      reason,
      startedAt,
      endedAt: deps.clock.now(),
      acceptedRunIds: [...acceptedRunIds],
      liveRunIds: [...liveRunIds],
      // Read before the clear below: onEnded fires after it, and these
      // counts do not exist anywhere else by then (#181).
      evidence: evidenceCounts(),
    }

    phase = 'absent'
    sessionId = null
    startedAt = null
    acceptedRunIds = []
    liveRunIds.clear()
    pendingSubmissionIds.clear()
    journal = []
    memory = []
    evidence?.clear()
    evidence = null
    continuityRevision += 1
    aboveHighWater = false
    compactionEpoch += 1
    cancelCompactionTimeout?.()
    cancelCompactionTimeout = null
    nextMemoryId = 1
    committedRunIds.clear()
    if (reason === 'reset') generation += 1
    deps.onEnded?.(ended)
    return ended
  }

  const warn = (): void => {
    cancelWarning = null
    if (phase !== 'active' || liveRunIds.size > 0 || sessionId === null || deadlineAt === null) return
    phase = 'expiring'
    deps.onExpiring?.({ sessionId, generation, at: deps.clock.now(), expiresAt: deadlineAt })
  }

  const lapse = (): void => {
    cancelDeadline = null
    if (phase !== 'expiring' || liveRunIds.size > 0) return
    endSession('lapsed')
  }

  const armInactivity = (): number | null => {
    cancelExpiry()
    if (
      deps.sessionWindowMs === undefined ||
      deps.warningLeadMs === undefined ||
      phase !== 'active' ||
      liveRunIds.size > 0
    ) return null
    deadlineAt = deps.clock.now() + deps.sessionWindowMs
    cancelWarning = deps.clock.setTimer(deps.sessionWindowMs - deps.warningLeadMs, warn)
    cancelDeadline = deps.clock.setTimer(deps.sessionWindowMs, lapse)
    return deadlineAt
  }

  const state = (): SessionRuntimeState => ({
    phase,
    sessionId,
    generation,
    startedAt,
    acceptedRunIds: [...acceptedRunIds],
    liveRunIds: [...liveRunIds],
  })

  const journalSnapshot = (): RunJournalSnapshot =>
    Object.freeze(journal.map((entry) => Object.freeze({ ...entry })))

  const memorySnapshot = (): WorkingMemorySnapshot => freezeWorkingMemory(memory)

  const matchesExpiringSession = (decision: SessionDecision): boolean =>
    phase === 'expiring' && sessionId === decision.sessionId && generation === decision.generation

  return {
    state,
    submit() {
      const submissionId = deps.identities.mintSubmissionId()
      pendingSubmissionIds.add(submissionId)
      return { submissionId, submittedAt: deps.clock.now() }
    },
    evidenceStore() {
      return evidence
    },
    accept(submissionId, utterance) {
      if (!pendingSubmissionIds.has(submissionId)) {
        throw new Error(`Submission is unknown or already admitted: ${submissionId}`)
      }

      const acceptedAt = deps.clock.now()
      const createsSession = phase === 'absent'
      const acceptedSessionId = createsSession ? deps.identities.mintSessionId() : sessionId!
      const runId = deps.identities.mintRunId()

      pendingSubmissionIds.delete(submissionId)
      if (createsSession) {
        sessionId = acceptedSessionId
        startedAt = acceptedAt
        acceptedRunIds = []
        journal = []
        memory = []
        continuityRevision += 1
        aboveHighWater = false
        nextMemoryId = 1
        committedRunIds.clear()
        evidence = createSessionEvidence({
          sessionId: acceptedSessionId,
          now: () => deps.clock.now(),
          mintId: () => `memory-${nextMemoryId++}` as MemoryEntryId,
          // The objective every Candidate decision is scoped to (#208,
          // ADR 0039), read from Working Memory at the moment it is
          // needed rather than copied into the store: one objective
          // identity, in one place, however often the user revises it.
          objectiveId: () => currentUserObjective(memory)?.id,
          // The Evidence Browser's change signal (#139): reads the live
          // generation at fire time — the store is cleared before a reset
          // bumps it, so a report can never carry a stale generation.
          // (Local const so the observer closure needs no non-null claim.)
          // Candidate changes ride the same signal (#142): a creation or
          // a decision is as visible a change as an accepted Observation.
          // The Run Trace rides the same observers as the change signal
          // (#181), so the file can never record a store change no view
          // was told about, or the reverse. The trace gets the store
          // detail; the signal stays identity-only.
          ...(noEvidenceObservers
            ? {}
            : {
              onObservationAccepted: (result) => {
                // Traced before the signal goes out, so the file reads in
                // the order things happened: the store changed, then the
                // views were told.
                reportAcceptance?.({
                  sessionId: acceptedSessionId,
                  generation,
                  change: 'observation',
                  entryId: result.observation.id,
                  counts: evidenceCounts(),
                  merged: result.merged,
                  contradicted: result.contradicts,
                })
                reportEvidence?.({ sessionId: acceptedSessionId, generation })
              },
              onCandidateChanged: (candidate) => {
                reportAcceptance?.({
                  sessionId: acceptedSessionId,
                  generation,
                  change: 'candidate',
                  entryId: candidate.id,
                  counts: evidenceCounts(),
                  // A Candidate never merges and never contradicts: both
                  // are Observation-checkpoint facts (#139, #143).
                  merged: false,
                  contradicted: [],
                })
                reportEvidence?.({ sessionId: acceptedSessionId, generation })
              },
            }),
        })
      }
      phase = 'active'
      cancelExpiry()

      acceptedRunIds.push(runId)
      liveRunIds.add(runId)

      // The inspection subject binds to the objective in force as this
      // Run is admitted (#210): the Run that presented it may have
      // recorded that objective in the same Memory Commit, after its own
      // admission memory was taken, so this is the first moment the two
      // can be joined. Once joined, a replacement objective clears the
      // subject the way ADR 0039 says it must.
      const objectiveInForce = currentUserObjective(memory)?.id
      const inspectionReference = objectiveInForce === undefined
        ? evidence!.inspectionReference()
        : evidence!.scopeInspection(objectiveInForce)
      // Retained corrections bind to their objective on the same beat and
      // for the same reason (#211): words spoken to the Run that then
      // recorded the user's task were spoken *for* that task, and only
      // here can the two be joined.
      if (objectiveInForce !== undefined) evidence!.scopeCorrections(objectiveInForce)
      // Anything still unresolved is about to be handed to a Run that did
      // not hear it (#211), so this is where it earns an identity that
      // Run can cite: the user's words, checkpointed as Session Evidence
      // under the Run they were spoken to. Before that Run's model
      // starts, like the retention itself.
      evidence!.groundCorrections()
      // The user's words, retained before this Run's first model request
      // (#211, ADR 0039). A Session's opening command corrects nothing —
      // there is no earlier work to correct, and a Reset replays it as
      // exactly that — so only a continuation retains. Nothing here reads
      // the words: retention is not interpretation, and what they turn
      // out to mean is the Run's to resolve and the Session's to keep
      // until it does.
      if (!createsSession && utterance !== undefined) {
        evidence!.retainCorrection({ text: utterance, runId })
      }
      const corrections = evidence!.unresolvedCorrections()
      return {
        accepted: true,
        submissionId,
        runId,
        sessionId: acceptedSessionId,
        generation,
        acceptedAt,
        createsSession,
        journal: journalSnapshot(),
        memory: memorySnapshot(),
        evidence: evidence!.snapshot(),
        // The Session's inspection subject (#210, ADR 0039), admitted
        // beside the evidence it resolves against and immutable for the
        // Run — a Run's own presentation lands on the store, and reaches
        // the next Run through its admission, never mid-flight.
        ...(inspectionReference !== null ? { inspection: inspectionReference } : {}),
        // The user's unresolved words (#211, ADR 0039), admitted beside
        // the subject they were spoken about. Immutable for the Run for
        // the same reason: what this Run resolves lands on the store and
        // reaches the next Run through its admission.
        ...(corrections.length > 0 ? { corrections } : {}),
      }
    },
    reject(submissionId) {
      return pendingSubmissionIds.delete(submissionId)
    },
    finish(runId) {
      const finished = liveRunIds.delete(runId)
      if (finished && liveRunIds.size === 0) armInactivity()
      return finished
    },
    commitRunContinuity(runId, outcome, text, patch, stop) {
      refreshContinuityProfile()
      /**
       * What a claimed user citation is checked against (#206, ADR 0039):
       * the live store, at commit time. A Session that ended between the
       * Answer and its Memory Commit grounds nothing — and a patch that
       * needed grounding it cannot get is refused, not downgraded.
       */
      const grounding: MemoryPatchGrounding = {
        isUserObservation: (id) => evidence?.observation(id)?.sourceKind === 'user',
      }
      const normalized = text.trim()
      if (!liveRunIds.has(runId) || committedRunIds.has(runId) || normalized === '' || normalized.length > MAX_RUN_NOTE_CHARS) {
        return 'rejected'
      }
      let proposedMemory = memory
      let proposedNextMemoryId = nextMemoryId
      if (outcome === 'done') {
        let proposedPatch = patch
        let projectionNextMemoryId = nextMemoryId
        const projectedMemory = applyMemoryPatch(
          memory,
          patch,
          runId,
          sessionId!,
          () => `memory-${projectionNextMemoryId++}` as MemoryEntryId,
          Number.MAX_SAFE_INTEGER,
          grounding,
        )
        const reservePressure =
          estimateWorkingMemoryTokens(memory) >= continuityBudgets.memory.reserve ||
          (projectedMemory !== null
            ? estimateWorkingMemoryTokens(projectedMemory) >= continuityBudgets.memory.reserve
            : estimateWorkingMemoryTokens(memory) + Math.ceil(JSON.stringify(patch).length / 4) >= continuityBudgets.memory.reserve)
        if (reservePressure) {
          const filtered: MemoryPatch[number][] = []
          let comparisonMemory = memory
          let comparisonId = 0
          for (const operation of patch) {
            if (isLowPriorityMemoryAddition(operation) || isDuplicateMemoryAddition(operation, comparisonMemory)) continue
            filtered.push(operation)
            const compared = applyMemoryPatch(
              comparisonMemory,
              [operation],
              runId,
              sessionId!,
              () => `reserve-check-${++comparisonId}` as MemoryEntryId,
              Number.MAX_SAFE_INTEGER,
              grounding,
            )
            if (compared !== null) comparisonMemory = compared
          }
          if (filtered.length !== patch.length) {
            proposedPatch = filtered
            degrade('reserve_addition_rejected')
          }
        }
        const applied = applyMemoryPatch(
          memory,
          proposedPatch,
          runId,
          sessionId!,
          () => `memory-${proposedNextMemoryId++}` as MemoryEntryId,
          continuityBudgets.memory.hard * 4,
          grounding,
        )
        if (applied === null) {
          let validationNextMemoryId = nextMemoryId
          const validWithoutHardLimit = applyMemoryPatch(
            memory,
            proposedPatch,
            runId,
            sessionId!,
            () => `memory-${validationNextMemoryId++}` as MemoryEntryId,
            Number.MAX_SAFE_INTEGER,
            grounding,
          )
          if (validWithoutHardLimit !== null) {
            degrade('hard_memory_rejection')
          }
          return 'invalid_patch'
        }
        proposedMemory = applied
      } else if (patch.length > 0) {
        return 'invalid_patch'
      }
      journal.push({ runId, outcome, text: normalized, ...(stop ? { stop } : {}) })
      // What the user's own entries cited *before* this commit (#211): the
      // citations it adds are what it resolves, and a citation an earlier
      // Run already made resolves nothing now. Working Memory is
      // cumulative, so reading the whole of it here would let a standing
      // constraint discharge a correction nobody had grounded — the user
      // repeating a phrase their objective already quotes would have their
      // new words dropped at the next unrelated commit.
      const citedBefore = new Map<MemoryEntryId, ReadonlySet<MemoryEntryId>>(
        memory.map((entry) => [entry.id, new Set(entry.userEvidenceIds ?? [])]),
      )
      memory = proposedMemory
      // The objective this Run's decisions were made for (#208, ADR 0039):
      // a Run decides as it works, but the objective the user set only
      // becomes Working Memory here, at its Memory Commit. Decisions made
      // before any objective existed are bound to the one now in force, so
      // a rejection made in the establishing Run is scoped to the task it
      // was made for rather than to nothing.
      const objectiveId = currentUserObjective(memory)?.id
      if (objectiveId !== undefined) evidence?.adoptUnscopedDecisions(objectiveId)
      // The user's corrections this commit carried into the task (#211,
      // ADR 0039). A correction with no Candidate to decide — "only posts
      // from 2023" — is resolved by the objective or constraint it
      // changed, and that entry earns its authority by citing the User
      // Observation holding those exact words. So the citations this
      // commit *added* are what it resolves: the same grounding #206
      // already requires, read for what it settles.
      evidence?.resolveCorrectionsCiting(
        memory.flatMap((entry) => {
          if (!hasUserAuthority(entry)) return []
          const before = citedBefore.get(entry.id)
          return (entry.userEvidenceIds ?? []).filter((id) => before === undefined || !before.has(id))
        }),
      )
      nextMemoryId = proposedNextMemoryId
      committedRunIds.add(runId)
      continuityRevision += 1
      const crossedHighWater = isAboveHighWater()
      if (crossedHighWater && !aboveHighWater) startCompaction()
      let omittedJournal = false
      while (journalTokens(journal) > continuityBudgets.journal.hard && journal.length > 0) {
        journal.shift()
        omittedJournal = true
      }
      if (omittedJournal) {
        degrade('hard_journal_omission')
      }
      aboveHighWater = isAboveHighWater()
      return 'committed'
    },
    extend(decision) {
      if (!matchesExpiringSession(decision)) return false
      phase = 'active'
      const expiresAt = armInactivity()
      if (expiresAt !== null && sessionId !== null) {
        deps.onExtended?.({ sessionId, generation, at: deps.clock.now(), expiresAt })
      }
      return true
    },
    decline(decision) {
      return matchesExpiringSession(decision) ? endSession('lapsed') : null
    },
    end(reason) {
      return endSession(reason)
    },
    dispose() {
      cancelExpiry()
      compactionEpoch += 1
      cancelCompactionTimeout?.()
      cancelCompactionTimeout = null
    },
  }
}
