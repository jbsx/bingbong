import { appViews } from '../command/appOp'
import { FLAG_HEADS, SPOKEN_CLI_HEADS } from '../command/cliGrammar'
import { DISMISS_PHRASES, DISMISS_VERBS } from '../command/dismissDialog'
import { refLessCardLabels } from '../command/jevReading'
import { LOCAL_MATCH_PHRASES, LOCAL_MATCH_VERBS } from '../command/localMatch'
import { MEDIA_OP_WORDS, MEDIA_OPS } from '../command/mediaOp'
import { MUSIC_KINDS, MUSIC_LINES } from '../music/musicWords'
import { FUNCTION_WORDS } from './pageTerms'

// The command half of the Seed Lexicon (#456): every word the app answers
// to, read off the tables that answer to it — the CLI grammar's heads, the
// Local Match's verb and search phrases, the Player's lines, every Media
// Op's label and done words, the dismiss phrases, the Flag's heads and
// every ref-less label the action card can offer (the browser's verbs, the
// Appliance Verbs, the facts, the app's options). Lifted by class, never
// by hand: a verb is lifted the day it lands, and "Look this song." for
// "Loop this song" was a verb the hand list never had.

/** A label or phrase as the decoder sees it: lower case, `_` and `-` as spaces, one space between words. */
function asSpoken(phrase: string): string {
  return phrase.toLowerCase().replace(/[_-]/g, ' ').trim().split(/\s+/).join(' ')
}

/** The command half of the Seed Lexicon, each phrase once, in source order. */
export function commandLexicon(): string[] {
  const sources = [SPOKEN_CLI_HEADS, LOCAL_MATCH_PHRASES, MUSIC_LINES, MEDIA_OP_WORDS, DISMISS_PHRASES, FLAG_HEADS, refLessCardLabels()]
  return [...new Set(sources.flat().map(asSpoken).filter((phrase) => phrase !== ''))]
}

/**
 * The grammar's heads (#471): one short term per verb and view the app
 * answers to — the first word of each table's own name for an action
 * (`scroll_down` → `scroll`, `show_idle` → `show`, `play_next` → `play`)
 * and every view's name (`idle`, `dashboard`, `weight`, `settings`) —
 * each once, in source order. The cloud ear's keyterm budget seats these
 * before any Page Term: the seed as a whole is 220 phrases, 207 of them
 * fit the ear's length and none the budget, so it needs a rank, which the
 * heads are. Lifted as {@link commandLexicon} lifts the seed, never by
 * hand: `idle` was the word the hand list never had.
 */
export function commandHeads(): string[] {
  // The app's own words first — the views, the card's ref-less labels — then the spoken verbs, the Player's, the media's, the
  // typed grammar's, the Flag's and the dismiss verbs: the budget cuts from the end once the Learned Terms have grown, and a
  // Page Term never carries `idle` while a page may carry `close`.
  const sources = [appViews(), refLessCardLabels(), LOCAL_MATCH_VERBS, MUSIC_KINDS, MEDIA_OPS, SPOKEN_CLI_HEADS, FLAG_HEADS, DISMISS_VERBS]
  const heads = [...new Set(sources.flat().map((phrase) => asSpoken(phrase).split(' ')[0] ?? ''))]
  // A function word or a single letter heads nothing the ear could be biased toward: `that` of "that was wrong", `x` of the
  // dismiss glyph. The off side of a toggle (`unmute`, `unloop`) is its head's own word with `un` before it, and takes no slot.
  return heads.filter((head) => head.length > 1 && !FUNCTION_WORDS.has(head) && !(head.startsWith('un') && heads.includes(head.slice(2))))
}
