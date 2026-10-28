import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { localMatch } from './localMatch'
import { fateUnread, newGoalLine, type Fate } from './runningCommand'

// The Fate a line takes over a running Command when no host answered
// (#504, the orchestrator's ruling 1): the Local Match's own read, the
// grammar's verb heads. Measured over every Sequence Case's later lines
// (fixtures/overlap-cases): a line the grammar settles is read by kind and
// never reaches the default; every other line takes the Fate its row means.

/** What each row's later line means for the line running, in the Fate's words: `replace` is `ends`, `add-on` is `goes_on`. */
const MEANT: Readonly<Record<string, Fate>> = {
  '1-replace-new-goal': 'ends',
  '12-search-while-page-changes': 'ends',
  '2-correct-by-coldplay': 'goes_on',
  '2-correct-by-radiohead': 'goes_on',
  '2-correct-the-other-one': 'goes_on',
  '3-add-on-loop': 'goes_on',
  '3-add-on-turn-it-down': 'goes_on',
  '4-skip-ahead-while-loading': 'goes_on',
  '5-independent-timer': 'goes_on',
  '7-is-it-working': 'goes_on',
  '7-what-are-you-doing': 'goes_on',
  '8-split-by-pause': 'goes_on',
  '10-move-on-while-speaking': 'goes_on',
}

const DIR = 'fixtures/overlap-cases'
const laterLines = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .flatMap((file) => ((JSON.parse(readFileSync(`${DIR}/${file}`, 'utf8')) as { lines: { words: string }[] }).lines.slice(1)).map((line) => ({ name: file.replace(/\.json$/, ''), words: line.words })))

describe('the Fate on a timed-out reading over a running Command (#504)', () => {
  it.each(laterLines)('$name: "$words" is read by kind as the grammar\'s, or takes the Fate its row means', ({ name, words }) => {
    if (localMatch(words, []) !== null) return
    expect(MEANT[name], `${name} reaches the default: name what it means`).toBeDefined()
    expect(fateUnread(words)).toBe(MEANT[name])
  })

  it('a verb head anywhere but the head is no new goal: the corrections and add-ons go on', () => {
    expect(fateUnread('no, play the other one')).toBe('goes_on')
    expect(fateUnread('and then open it')).toBe('goes_on')
    expect(fateUnread('play something by blur')).toBe('ends')
    expect(fateUnread('Search for the forecast')).toBe('ends')
    expect(fateUnread('go to the bbc')).toBe('ends')
  })

  it('the handoff is said in the line\'s own words, its end mark dropped', () => {
    expect(newGoalLine('open the weather.')).toBe('Taking that as a new goal: open the weather.')
    expect(newGoalLine(' no, the other one ')).toBe('Taking that as a new goal: no, the other one.')
  })
})
