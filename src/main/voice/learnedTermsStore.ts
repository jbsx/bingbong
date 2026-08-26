import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  applyMishearProposals,
  emptyLearnedTermsState,
  normalizeLearnedTerm,
  sanitizeLearnedTermsState,
  touchLearnedTerms,
  type LearnedTermsState,
  type MishearProposal,
} from '../../core/voice/learnedTerms'
import { BIAS_LEXICON } from '../moonshine/biasLexicon'

// The Learned Terms ledger's persistence (ADR 0022): lexicon.json in
// userData, the same shape as the settings and usage stores. State
// transitions live in core (learnedTerms.ts); this store owns the file, the
// clock, and the change notifications. A corrupt file fails closed to
// seed-only — the decode keeps working, the vocabulary restarts empty, and
// the next write replaces the corrupt file.

/** The normalized Seed Lexicon — the reserved set no proposal may admit. */
export function seedLexiconSet(): ReadonlySet<string> {
  return new Set(
    BIAS_LEXICON
      .map((term) => normalizeLearnedTerm(term))
      .filter((term): term is string => term !== null),
  )
}

export interface LearnedTermsStore {
  /** The pipeline seam (ADR 0022): apply one Run's validated proposals. */
  applyProposals(proposals: readonly MishearProposal[]): void
  /** The pipeline seam: LRU-touch admitted terms the transcript used. */
  observeTranscript(text: string): void
  /** The admitted terms, in admission order — the Settings list. */
  list(): readonly string[]
  /**
   * The full bias input: Seed Lexicon followed by Learned Terms. The array
   * identity is stable between ledger changes, so the transcriber's applier
   * cache rebuilds only when the vocabulary actually changes.
   */
  biasPhrases(): readonly string[]
  /** Settings surface: admit directly and clear any rejection mark. */
  manualAdd(raw: string): boolean
  /** Settings surface: remove and plant a rejection proposals cannot cross. */
  manualRemove(raw: string): boolean
  /** Fires with the new admitted list whenever it changes. */
  onChange(listener: (terms: readonly string[]) => void): () => void
}

function persist(path: string, state: LearnedTermsState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function createLearnedTermsStore(
  path: string,
  reserved: ReadonlySet<string>,
  deps?: { now?: () => number },
): LearnedTermsStore {
  const now = deps?.now ?? (() => Date.now())
  let state: LearnedTermsState
  try {
    state = sanitizeLearnedTermsState(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    state = emptyLearnedTermsState()
  }

  const listeners = new Set<(terms: readonly string[]) => void>()
  let union: readonly string[] | null = null

  function commit(next: LearnedTermsState): void {
    const before = state.admitted.map((t) => t.term).join('\u0000')
    state = next
    persist(path, state)
    const after = state.admitted.map((t) => t.term)
    if (after.join('\u0000') !== before) {
      // Only a vocabulary change rebuilds the bias union — a pure LRU
      // touch leaves the decode input (and its cache) alone.
      union = null
      for (const listener of listeners) {
        try {
          listener(after)
        } catch {
          // A throwing subscriber never breaks the ledger.
        }
      }
    }
  }

  return {
    applyProposals(proposals) {
      const { state: next } = applyMishearProposals(state, proposals, now(), reserved)
      if (next !== state) commit(next)
    },
    observeTranscript(text) {
      const next = touchLearnedTerms(state, text, now())
      if (next !== state) commit(next)
    },
    list() {
      return state.admitted.map((t) => t.term)
    },
    biasPhrases() {
      if (union === null) union = [...BIAS_LEXICON, ...state.admitted.map((t) => t.term)]
      return union
    },
    manualAdd(raw) {
      const term = normalizeLearnedTerm(raw)
      if (term === null || reserved.has(term)) return false
      const next: LearnedTermsState = {
        pending: state.pending.filter((p) => p.term !== term),
        admitted: state.admitted.some((t) => t.term === term)
          ? state.admitted
          : [...state.admitted, { term, admittedAt: now(), lastTouched: now() }],
        rejected: state.rejected.filter((rejected) => rejected !== term),
      }
      commit(next)
      return true
    },
    manualRemove(raw) {
      const term = normalizeLearnedTerm(raw)
      if (term === null) return false
      const next: LearnedTermsState = {
        pending: state.pending.filter((p) => p.term !== term),
        admitted: state.admitted.filter((t) => t.term !== term),
        rejected: state.rejected.includes(term) ? state.rejected : [...state.rejected, term],
      }
      commit(next)
      return true
    },
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
