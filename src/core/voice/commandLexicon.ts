import { CLI_HEADS } from '../command/cliGrammar'
import { DISMISS_PHRASES } from '../command/dismissDialog'
import { refLessCardLabels } from '../command/jevReading'
import { LOCAL_MATCH_PHRASES } from '../command/localMatch'
import { MEDIA_OP_WORDS } from '../command/mediaOp'
import { MUSIC_LINES } from '../music/musicWords'

// The command half of the Seed Lexicon (#456): every word the app answers
// to, read off the tables that answer to it — the CLI grammar's heads, the
// Local Match's verb and search phrases, the Player's lines, every Media
// Op's label and done words, the dismiss phrases, and every
// ref-less label the action card can offer (the browser's verbs, the
// Appliance Verbs, the facts, the app's options). Lifted by class, never
// by hand: a verb is lifted the day it lands, and "Look this song." for
// "Loop this song" was a verb the hand list never had.

/** A label or phrase as the decoder sees it: lower case, `_` and `-` as spaces, one space between words. */
function asSpoken(phrase: string): string {
  return phrase.toLowerCase().replace(/[_-]/g, ' ').trim().split(/\s+/).join(' ')
}

/** The command half of the Seed Lexicon, each phrase once, in source order. */
export function commandLexicon(): string[] {
  const sources = [CLI_HEADS, LOCAL_MATCH_PHRASES, MUSIC_LINES, MEDIA_OP_WORDS, DISMISS_PHRASES, refLessCardLabels()]
  return [...new Set(sources.flat().map(asSpoken).filter((phrase) => phrase !== ''))]
}
