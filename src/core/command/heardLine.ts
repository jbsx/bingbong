import { readFlagLine } from './cliGrammar'
import { localMatch, type KnownAddressOf } from './localMatch'
import { wholeCommandHearing } from './nameMatch'

/**
 * The exact line a spoken line is wholly heard as (#478): its one command
 * Hearing covers every word ({@link wholeCommandHearing}), and that phrase
 * is a line read with no ask — a Flag head, or a Local Match with no page.
 * A phrase Jev reads (an app option, a dismiss phrase over a pop-up) is
 * left to the card. Null for any other line, which goes on as heard.
 */
export function exactLineHeard(text: string, learned: readonly string[], commands: readonly string[], known?: KnownAddressOf): string | null {
  const line = wholeCommandHearing(text, learned, commands)
  return line !== null && (readFlagLine(line) !== null || localMatch(line, [], known) !== null) ? line : null
}
