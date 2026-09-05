import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  applyMishearProposals,
  emptyLearnedTermsState,
  normalizeLearnedTerm,
  sanitizeLearnedTermsState,
  touchLearnedTerms,
  type LearnedTermsControls,
  type LearnedTermsState,
} from '../../core/voice/learnedTerms'
import { BIAS_LEXICON, seedLexiconSet } from '../moonshine/biasLexicon'
import type { HostTraceWriter } from '../../core/trace/hostTrace'
import { reportFault } from '../../core/trace/fault'

export { seedLexiconSet }

// The Learned Terms ledger's persistence (ADR 0022): lexicon.json in
// userData, the same shape as the settings and usage stores. State
// transitions live in core (learnedTerms.ts); this store owns the file, the
// clock, and the change notifications. A corrupt file fails closed to
// seed-only — the decode keeps working, the vocabulary restarts empty, and
// the next write replaces the corrupt file.

export interface LearnedTermsStore extends LearnedTermsControls {
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
  deps?: {
    now?: () => number
    /**
     * The Host Trace writer (#186, ADR 0031): where a change to the
     * lexicon is recorded. It replaces the two `console.log` lines this
     * store used to leave — the growth of the lexicon is ADR 0022's whole
     * story, and it belongs in a file that can be read after the fact,
     * beside the transcripts the admissions came from. Absent unless the
     * developer set `BINGBONG_HOST_TRACE`.
     */
    hostTrace?: HostTraceWriter
  },
): LearnedTermsStore {
  const now = deps?.now ?? (() => Date.now())
  const traceChange = (source: 'proposals' | 'manual', admitted: readonly string[], removed: readonly string[]): void => {
    if (admitted.length === 0 && removed.length === 0) return
    deps?.hostTrace?.(() => ({ kind: 'learned_term', source, admitted, removed }))
  }
  let state: LearnedTermsState
  try {
    state = sanitizeLearnedTermsState(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    reportFault('voice.learnedTermsStore.load', error)
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
        } catch (error) {
          reportFault('voice.learnedTermsStore.notify', error)
          // A throwing subscriber never breaks the ledger.
        }
      }
    }
  }

  return {
    applyProposals(proposals) {
      const { state: next, effects } = applyMishearProposals(state, proposals, now(), reserved)
      if (next !== state) commit(next)
      // One record per admission/removal — the growth of the lexicon is
      // the ADR's whole story; the Host Trace is how you watch it happen.
      traceChange('proposals', effects.admitted, effects.removed)
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
      const alreadyAdmitted = state.admitted.some((t) => t.term === term)
      const next: LearnedTermsState = {
        pending: state.pending.filter((p) => p.term !== term),
        admitted: alreadyAdmitted
          ? state.admitted
          : [...state.admitted, { term, admittedAt: now(), lastTouched: now() }],
        rejected: state.rejected.filter((rejected) => rejected !== term),
      }
      commit(next)
      // Only a vocabulary change is a record: re-adding a term already in
      // the lexicon clears a rejection mark and admits nothing.
      if (!alreadyAdmitted) traceChange('manual', [term], [])
      return true
    },
    manualRemove(raw) {
      const term = normalizeLearnedTerm(raw)
      if (term === null) return false
      const wasAdmitted = state.admitted.some((t) => t.term === term)
      const next: LearnedTermsState = {
        pending: state.pending.filter((p) => p.term !== term),
        admitted: state.admitted.filter((t) => t.term !== term),
        rejected: state.rejected.includes(term) ? state.rejected : [...state.rejected, term],
      }
      commit(next)
      if (wasAdmitted) traceChange('manual', [], [term])
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
