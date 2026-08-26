// Learned Terms (ADR 0022): the app half of "the model proposes; the app
// disposes." This is the pure ledger — the recurrence gate that admits a
// term only when two Runs propose it identically, the immediate removal
// path, the rejection marks a manual delete leaves, and the LRU order the
// cap evicts by. No file, no clock, no model: state transitions only.
//
// The cache discipline: a first proposal is a miss (recorded, admitted as
// nothing); the recurrence is the proof. This starves the self-reinforcement
// loop a wrongly-admitted spelling would otherwise feed — the boosted decode
// transcribing toward the wrong word, the model reading its own guess back
// as confirmation.

/** Settled in the design session: the Learned Term ceiling, LRU-evicted. */
export const LEARNED_TERM_CAP = 500

/** A Learned Term is a phrase, not a sentence — cap at four words. */
const MAX_TERM_WORDS = 4

/** One answer carries at most this many proposals — "at most a few" in the prompt, enforced here. */
export const MAX_PROPOSALS_PER_RUN = 20

/** Pending proposals are bounded too: one-off garbage must not pile up. */
const MAX_PENDING = LEARNED_TERM_CAP

/**
 * One end-of-message Mishear proposal from the orchestrator: either a
 * confident repair (the garbled transcript word and what was actually meant)
 * or the removal of a Learned Term the model can see is wrong.
 */
export type MishearProposal =
  | { op: 'add'; suspect: string; repair: string }
  | { op: 'remove'; term: string }

/** One admitted Learned Term with its LRU bookkeeping. */
export interface AdmittedTerm {
  term: string
  admittedAt: number
  /** Last evidence the term is in active use — admission, re-proposal, or a transcript that contains it. */
  lastTouched: number
}

/**
 * The pipeline's view of the ledger: the two touchpoints a Run has with
 * the lexicon. Declared once here so the core pipeline dep and the main
 * wiring cannot drift apart.
 */
export interface LearnedTermsControls {
  /** Apply one Run's end-of-message proposals (recurrence-gated). */
  applyProposals(proposals: readonly MishearProposal[]): void
  /** LRU touch: the run's input text used admitted terms. */
  observeTranscript(text: string): void
}

/** The persisted ledger: pending proposals, admitted terms, rejection marks. */
export interface LearnedTermsState {
  pending: { term: string; at: number }[]
  admitted: AdmittedTerm[]
  /** Terms a human deleted: proposals can never readmit them; a manual add clears the mark. */
  rejected: string[]
}

export function emptyLearnedTermsState(): LearnedTermsState {
  return { pending: [], admitted: [], rejected: [] }
}

/**
 * Normalize a candidate term the way the decoder will see it: lowercase,
 * whitespace-collapsed. Null when the term is empty or longer than four
 * words — those are not vocabulary, they are sentences.
 */
export function normalizeLearnedTerm(raw: string): string | null {
  const words = raw.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > MAX_TERM_WORDS) return null
  return words.join(' ')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Parse the model's `mishear_proposals` — the same strictness as
 * parseMemoryPatch: anything malformed rejects the whole array, so a
 * half-valid proposal never reaches the ledger. An empty array is a valid
 * no-op, exactly like an empty memory patch.
 */
export function parseMishearProposals(value: unknown): MishearProposal[] | null {
  if (!Array.isArray(value) || value.length > MAX_PROPOSALS_PER_RUN) return null
  const proposals: MishearProposal[] = []
  for (const item of value) {
    const raw = asRecord(item)
    if (!raw) return null
    if (raw.op === 'add') {
      if (Object.keys(raw).some((key) => !['op', 'suspect', 'repair'].includes(key))) return null
      if (typeof raw.suspect !== 'string' || raw.suspect.trim() === '') return null
      if (typeof raw.repair !== 'string' || raw.repair.trim() === '') return null
      proposals.push({ op: 'add', suspect: raw.suspect, repair: raw.repair })
      continue
    }
    if (raw.op === 'remove') {
      if (Object.keys(raw).some((key) => !['op', 'term'].includes(key))) return null
      if (typeof raw.term !== 'string' || raw.term.trim() === '') return null
      proposals.push({ op: 'remove', term: raw.term })
      continue
    }
    return null
  }
  return proposals
}

/** What one application did — the diagnostics the store logs. */
export interface LearnedTermsEffects {
  admitted: string[]
  removed: string[]
}

/**
 * Apply one Run's end-of-message proposals. Adds are recurrence-gated (a
 * term already pending is admitted; a new one only pends; a Seed Lexicon or
 * rejected term is invisible); removals apply immediately to admitted and
 * pending alike. Duplicate adds inside one Run count once — recurrence is
 * across Runs, by design.
 */
export function applyMishearProposals(
  state: LearnedTermsState,
  proposals: readonly MishearProposal[],
  now: number,
  reserved: ReadonlySet<string>,
): { state: LearnedTermsState; effects: LearnedTermsEffects } {
  const pending = state.pending.map((p) => ({ ...p }))
  const admitted = state.admitted.map((t) => ({ ...t }))
  const rejected = [...state.rejected]
  const effects: LearnedTermsEffects = { admitted: [], removed: [] }

  // One Run's identical adds count once: dedupe by normalized repair.
  const adds = new Set<string>()
  const removals = new Set<string>()
  for (const proposal of proposals) {
    if (proposal.op === 'add') {
      const term = normalizeLearnedTerm(proposal.repair)
      if (term !== null) adds.add(term)
    } else {
      const term = normalizeLearnedTerm(proposal.term)
      if (term !== null) removals.add(term)
    }
  }

  // Removals first: a wrong admitted spelling must not survive into the
  // same Run's repair of the same word.
  for (const term of removals) {
    const admittedIndex = admitted.findIndex((t) => t.term === term)
    if (admittedIndex !== -1) {
      admitted.splice(admittedIndex, 1)
      effects.removed.push(term)
    }
    const pendingIndex = pending.findIndex((p) => p.term === term)
    if (pendingIndex !== -1) pending.splice(pendingIndex, 1)
  }

  for (const term of adds) {
    // The app gate: seed vocabulary and rejected terms are not its business,
    // and a pending term only becomes admitted by recurrence.
    if (reserved.has(term) || rejected.includes(term)) continue
    const admittedIndex = admitted.findIndex((t) => t.term === term)
    if (admittedIndex !== -1) {
      admitted[admittedIndex]!.lastTouched = now
      continue
    }
    const pendingIndex = pending.findIndex((p) => p.term === term)
    if (pendingIndex === -1) {
      pending.push({ term, at: now })
      continue
    }
    pending.splice(pendingIndex, 1)
    admitted.push({ term, admittedAt: now, lastTouched: now })
    effects.admitted.push(term)
  }

  // The cap evicts the least-recently-touched term — stale vocabulary
  // yields to fresh, cache-style. Pending bound is FIFO by arrival.
  while (admitted.length > LEARNED_TERM_CAP) {
    let stalest = 0
    for (let i = 1; i < admitted.length; i += 1) {
      if (admitted[i]!.lastTouched < admitted[stalest]!.lastTouched) stalest = i
    }
    admitted.splice(stalest, 1)
  }
  while (pending.length > MAX_PENDING) pending.shift()

  return {
    state: { pending, admitted, rejected },
    effects,
  }
}

/**
 * LRU touch from use: a transcript containing an admitted term is the
 * honest "recently biased" signal — the term earned its place by appearing
 * in what the user actually said.
 */
export function touchLearnedTerms(
  state: LearnedTermsState,
  transcript: string,
  now: number,
): LearnedTermsState {
  if (state.admitted.length === 0) return state
  const lower = transcript.toLowerCase()
  let touched = false
  const admitted = state.admitted.map((term) => {
    if (!matchesTerm(lower, term.term)) return term
    touched = true
    return { ...term, lastTouched: now }
  })
  return touched ? { ...state, admitted } : state
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Word-boundary containment: "panel" matches "open the panel", not "panels". */
function matchesTerm(lowerTranscript: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`).test(lowerTranscript)
}

function asAdmittedTerm(value: unknown): AdmittedTerm | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.term !== 'string') return null
  const term = normalizeLearnedTerm(raw.term)
  if (term === null || term !== raw.term) return null
  if (typeof raw.admittedAt !== 'number' || typeof raw.lastTouched !== 'number') return null
  return { term, admittedAt: raw.admittedAt, lastTouched: raw.lastTouched }
}

/**
 * Parse anything (disk) into a valid ledger; corrupt or unknown bits are
 * dropped, never defaulted into vocabulary. Fail-closed: a bad file leaves
 * the app seed-only, not seeded with garbage.
 */
export function sanitizeLearnedTermsState(raw: unknown): LearnedTermsState {
  const record = asRecord(raw)
  if (!record) return emptyLearnedTermsState()

  const pendingRaw = Array.isArray(record.pending) ? record.pending : []
  const admittedRaw = Array.isArray(record.admitted) ? record.admitted : []
  const rejectedRaw = Array.isArray(record.rejected) ? record.rejected : []

  const state = emptyLearnedTermsState()
  const seenPending = new Set<string>()
  for (const item of pendingRaw) {
    const entry = asRecord(item)
    if (!entry || typeof entry.term !== 'string' || typeof entry.at !== 'number') continue
    const term = normalizeLearnedTerm(entry.term)
    if (term === null || term !== entry.term || seenPending.has(term)) continue
    seenPending.add(term)
    state.pending.push({ term, at: entry.at })
  }
  const seenAdmitted = new Set<string>()
  for (const item of admittedRaw) {
    const term = asAdmittedTerm(item)
    if (!term || seenAdmitted.has(term.term)) continue
    seenAdmitted.add(term.term)
    state.admitted.push(term)
  }
  for (const item of rejectedRaw) {
    if (typeof item !== 'string') continue
    const term = normalizeLearnedTerm(item)
    if (term === null || term !== item || state.rejected.includes(term)) continue
    state.rejected.push(term)
  }
  // Cross hygiene: a term is in exactly one compartment.
  state.pending = state.pending.filter((p) => !seenAdmitted.has(p.term) && !state.rejected.includes(p.term))
  state.admitted = state.admitted.filter((t) => !state.rejected.includes(t.term))
  while (state.admitted.length > LEARNED_TERM_CAP) state.admitted.pop()
  while (state.pending.length > MAX_PENDING) state.pending.shift()
  return state
}
