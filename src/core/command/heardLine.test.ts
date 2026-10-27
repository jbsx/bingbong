import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandLexicon } from '../voice/commandLexicon'
import { exactLineHeard } from './heardLine'
import { commandHearingTerms } from './nameMatch'

// A spoken line wholly heard as one exact line fires it with no ask (#478).
// The lure test: every line the ledger and the STT labels hold — the words
// the ear gave and the words said — read as spoken, and each one that would
// fire is listed with what it was meant to do. None that is not a command
// may fire, and none may fire another command than the one meant.

const commands = commandHearingTerms(commandLexicon())

function corpusLines(): string[] {
  const ledger = readdirSync('fixtures/failed-lines')
    .filter((file) => file.endsWith('.json'))
    .map((file) => (JSON.parse(readFileSync(`fixtures/failed-lines/${file}`, 'utf8')) as { transcript?: unknown }).transcript)
  const labels = Object.values((JSON.parse(readFileSync('fixtures/stt-labels/audio-dumps-2026-10.json', 'utf8')) as { labels: Record<string, { said: string }> }).labels).map((label) => label.said)
  const heard = Object.values(JSON.parse(readFileSync('fixtures/stt-labels/stt-gate.json', 'utf8')) as Record<string, { heard: string }>).map((dump) => dump.heard)
  return [...new Set([...ledger, ...labels, ...heard].filter((line): line is string => typeof line === 'string'))]
}

describe('exactLineHeard (#478)', () => {
  it('fires on the ledger and the STT labels only the lines meant as the command they are heard as', () => {
    const fired = corpusLines().flatMap((line) => {
      const exact = exactLineHeard(line, [], commands)
      return exact === null ? [] : [`${line} → ${exact}`]
    })
    expect(fired.sort()).toEqual(
      [
        // turn-mvpdteuq-v10: the Flag of 'Double.', heard by Parakeet.
        'Mark as junior. → mark as failure',
        // turn-mvphzt81-vq and its ElevenLabs dump: the Flag of 'Title page.'.
        'Mark as flagged. → mark as failure',
        'mark as flagged → mark as failure',
        // "loop the song", typed on the ledger (turn-mvh0wouq-6) and said on the dumps: the Player's loop.
        'loop the song → loop this song',
        'Loop the song. → loop this song',
        // turn-mvqga9a7-v1g, turn-mvqgaqvp-v1h: said at the song's end, meant to play it again — which a `repeat` line
        // does there; still playing, it loops.
        'Repeat the song. → repeat this song',
      ].sort(),
    )
  })

  it('reads the ledger line "Mark as junior." as the Flag (turn-mvpdteuq-v10)', () => {
    expect(exactLineHeard('Mark as junior.', [], commands)).toBe('mark as failure')
  })

  it('leaves to the card a phrase Jev reads, and a line it reads with its words as heard', () => {
    // `show settings` is an app option the card offers, never an exact line.
    expect(exactLineHeard('so settings', [], commands)).toBeNull()
    // "Stop this song." (meant "loop") sounds like "skip this song", its verb heard as another.
    expect(exactLineHeard('Stop this song.', [], commands)).toBeNull()
  })
})
