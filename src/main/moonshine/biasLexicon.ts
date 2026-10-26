// The STT contextual-biasing lexicon (#62): the app's own vocabulary that
// the decode boosts toward (see contextualBiasing.ts).
//
// The Seed Lexicon half of the Bias Lexicon (ADR 0022): frozen in source,
// the reserved set no runtime proposal may admit as a Learned Term. Two
// halves (#456): the command half is built from the tables the app answers
// by (commandLexicon.ts), so every verb is lifted by class; the rest is the
// app's other vocabulary — the settings' and the dashboard's names — kept
// by hand, as no table says them.

import { normalizeLearnedTerm } from '../../core/voice/learnedTerms'
import { commandLexicon } from '../../core/voice/commandLexicon'

/** The vocabulary no command table says: kept by hand, every entry a near-tie waiting to be flipped. */
const NAMES: readonly string[] = [
    // Settings names (voice-settable surface, ADR 0006)
    'wake word',
    'wake threshold',
    'endpoint delay',
    'web zoom',
    'web',
    'zoom',
    'voice',
    'adblock',
    'ad blocker',
    'weather city',
    'celsius',
    'fahrenheit',
    'metric',
    'imperial',

    // Dashboard vocabulary
    'dashboard',
    'idle screen',
    'feed entry',
]

export const BIAS_LEXICON: readonly string[] = [...new Set([...commandLexicon(), ...NAMES])]

/** The Seed Lexicon as the admission gate's reserved set (normalized). */
export function seedLexiconSet(): ReadonlySet<string> {
    return new Set(
        BIAS_LEXICON
            .map((term) => normalizeLearnedTerm(term))
            .filter((term): term is string => term !== null),
    )
}
