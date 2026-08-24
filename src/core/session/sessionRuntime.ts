import type { Clock } from '../ports/clock'
import type {
  RunId,
  SessionGeneration,
  SessionId,
  SessionIdentitySource,
  SubmissionId,
} from './sessionIdentity'
import { MAX_RUN_NOTE_CHARS, type RunJournalEntry, type RunJournalSnapshot } from './runJournal'
import {
  applyMemoryPatch,
  estimateWorkingMemoryTokens,
  freezeWorkingMemory,
  isDuplicateMemoryAddition,
  isLowPriorityMemoryAddition,
  isValidWorkingMemory,
  MAX_MEMORY_DETAIL_CHARS,
  MAX_MEMORY_REFERENCES,
  type MemoryEntry,
  type MemoryEntryId,
  type MemoryPatch,
  type WorkingMemorySnapshot,
} from './workingMemory'

export type { RunJournalEntry, RunJournalSnapshot } from './runJournal'
export type { MemoryEntry, MemoryPatch, WorkingMemorySnapshot } from './workingMemory'

export type { SessionGeneration } from './sessionIdentity'

export type SessionPhase = 'absent' | 'active' | 'expiring'
export type SessionEndReason = 'lapsed' | 'reset' | 'app_closed' | 'interrupted'

/**
 * A Session stays open while the gap after the latest accepted Run's finish
 * is shorter than this window. 30 minutes (ADR 0005 widened ADR 0001's
 * original 10).
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
  accept(submissionId: SubmissionId): AcceptedRunAdmission
  reject(submissionId: SubmissionId): boolean
  finish(runId: RunId): boolean
  commitRunContinuity(
    runId: RunId,
    outcome: RunJournalEntry['outcome'],
    text: string,
    patch: MemoryPatch,
  ): 'committed' | 'invalid_patch' | 'rejected'
  beginExpiry(): boolean
  extend(decision: SessionDecision): boolean
  decline(decision: SessionDecision): EndedSession | null
  end(reason: SessionEndReason): EndedSession | null
  dispose(): void
}

export function createSessionRuntime(deps: {
  clock: Clock
  identities: SessionIdentitySource
  inactivityMs?: number
  warningLeadMs?: number
  onExpiring?: (session: ExpiringSession) => void
  onExtended?: (session: ExtendedSession) => void
  onEnded?: (session: EndedSession) => void
  continuityModel?: string | (() => string)
  continuityBudgets?: Readonly<Record<string, SessionContinuityBudgets>>
  compactContinuity?: (request: ContinuityCompactionRequest) => Promise<ContinuityCompaction>
  compactionTimeoutMs?: number
  recentJournalEntries?: number
  recentMemoryEntries?: number
  onContinuityDegraded?: (degradation: ContinuityDegradation) => void
  /** @deprecated Prefer model-specific continuityBudgets. */
  maxJournalChars?: number
  /** @deprecated Prefer model-specific continuityBudgets. */
  maxMemoryChars?: number
}): SessionRuntime {
  if (deps.inactivityMs !== undefined) {
    if (!Number.isFinite(deps.inactivityMs) || deps.inactivityMs <= 0) {
      throw new Error('inactivityMs must be positive')
    }
    if (deps.warningLeadMs === undefined || !Number.isFinite(deps.warningLeadMs) || deps.warningLeadMs <= 0) {
      throw new Error('warningLeadMs must be positive when inactivityMs is configured')
    }
    if (deps.warningLeadMs >= deps.inactivityMs) {
      throw new Error('warningLeadMs must be shorter than inactivityMs')
    }
  }
  const maxJournalChars = deps.maxJournalChars ?? 12_000
  if (!Number.isFinite(maxJournalChars) || maxJournalChars < MAX_RUN_NOTE_CHARS) {
    throw new Error(`maxJournalChars must be at least ${MAX_RUN_NOTE_CHARS}`)
  }
  const maxMemoryChars = deps.maxMemoryChars ?? 24_000
  if (!Number.isFinite(maxMemoryChars) || maxMemoryChars < 1_000) {
    throw new Error('maxMemoryChars must be at least 1000')
  }
  const fallbackBudgets: SessionContinuityBudgets = {
    journal: {
      high: Math.floor(maxJournalChars * 0.8 / 4),
      reserve: Math.floor(maxJournalChars * 0.9 / 4),
      hard: Math.floor(maxJournalChars / 4),
    },
    memory: {
      high: Math.floor(maxMemoryChars * 0.8 / 4),
      reserve: Math.floor(maxMemoryChars * 0.9 / 4),
      hard: Math.floor(maxMemoryChars / 4),
    },
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
    } catch {
      // Continuity diagnostics are maintenance-only and cannot fail a Run.
    }
  }
  let model = 'default'
  let continuityBudgets = fallbackBudgets
  try {
    model = resolveModel()
    continuityBudgets = resolveBudgets(model)
  } catch {
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
  const liveRunIds = new Set<RunId>()
  const pendingSubmissionIds = new Set<SubmissionId>()
  let journal: RunJournalEntry[] = []
  let memory: MemoryEntry[] = []
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
    } catch {
      degrade('budget_profile_invalid')
      return
    }
    model = selectedModel
    continuityBudgets = selectedBudgets
    aboveHighWater = false
  }

  const journalTokens = (entries: readonly RunJournalEntry[]): number =>
    Math.ceil(entries.reduce((total, entry) => total + entry.text.length, 0) / 4)

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
    if (
      journalTokens(candidate.journal) > requestBudgets.journal.high ||
      !isValidWorkingMemory(candidate.memory, expectedSessionId, requestBudgets.memory.high)
    ) return false
    const journalByRunId = new Map(originalJournal.map((entry) => [entry.runId, entry]))
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
      !preservesIdentityOrder(originalJournal, candidate.journal, ({ runId }) => runId) ||
      !preservesIdentityOrder(originalMemory, candidate.memory, ({ id }) => id)
    ) return false

    const protectedJournal = originalJournal.filter((entry, index) =>
      entry.outcome === 'failed' || index >= originalJournal.length - recentJournalEntries,
    )
    const protectedMemory = originalMemory.filter((entry, index) =>
      index >= originalMemory.length - recentMemoryEntries || entry.kind !== 'finding',
    )
    if (
      protectedJournal.some((entry) => !includesEntry(candidate.journal, entry)) ||
      protectedMemory.some((entry) => !includesEntry(candidate.memory, entry))
    ) return false
    if (!compactsOldestFirst(
      originalJournal,
      candidate.journal,
      (entry, index) => entry.outcome !== 'failed' && index < originalJournal.length - recentJournalEntries,
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
    } catch {
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
    } catch {
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
      const compactedJournal = candidate.journal.map((entry) => ({ ...entry }))
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
    }

    phase = 'absent'
    sessionId = null
    startedAt = null
    acceptedRunIds = []
    liveRunIds.clear()
    pendingSubmissionIds.clear()
    journal = []
    memory = []
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
      deps.inactivityMs === undefined ||
      deps.warningLeadMs === undefined ||
      phase !== 'active' ||
      liveRunIds.size > 0
    ) return null
    deadlineAt = deps.clock.now() + deps.inactivityMs
    cancelWarning = deps.clock.setTimer(deps.inactivityMs - deps.warningLeadMs, warn)
    cancelDeadline = deps.clock.setTimer(deps.inactivityMs, lapse)
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
    accept(submissionId) {
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
      }
      phase = 'active'
      cancelExpiry()

      acceptedRunIds.push(runId)
      liveRunIds.add(runId)

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
    commitRunContinuity(runId, outcome, text, patch) {
      refreshContinuityProfile()
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
      journal.push({ runId, outcome, text: normalized })
      memory = proposedMemory
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
    beginExpiry() {
      if (phase !== 'active' || liveRunIds.size > 0) return false
      phase = 'expiring'
      return true
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
