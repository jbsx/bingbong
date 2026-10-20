// Jev's readings for the scripted stand-in (BINGBONG_DECISION_SCRIPT): a
// line with free words is Jev's (ADR 0079), so a suite that types `play
// <words>` scripts the reading it would get. Each entry answers only the
// ask whose state carries its line, so a consent wall's ask or another
// line's never takes it; a Choice names its label alone.

interface Reading {
  /** The line, as typed. */
  readonly line: string
  /** The verb Choice's label: a browser verb or a Capability. */
  readonly verb: string
  /** The Slot's words as a span label (`s1-2`); `none` when it carries none. */
  readonly slot?: string
}

const choice = (label: string) => ({ type: 'choice', choice: label, confidence: 0.9 })

/** A line's reading: `play <words>` and `queue <words>` the Capability with the words past the first as the Slot. */
export function readingOf(line: string, verb?: string): Reading {
  const words = line.trim().split(/\s+/)
  const head = words[0]!.toLowerCase()
  if (verb === undefined && (head === 'play' || head === 'queue')) return { line, verb: head, slot: `s1-${words.length - 1}` }
  return { line, verb: verb ?? 'none' }
}

/** The env that scripts these readings, in the order they are typed. */
export function decisionScript(...readings: Reading[]): { BINGBONG_DECISION_SCRIPT: string } {
  const entries = readings.map((reading) => ({
    when: JSON.stringify(reading.line),
    answers: { verb: choice(reading.verb), target: choice('none'), slot: choice(reading.slot ?? 'none'), where: choice('web') },
  }))
  return { BINGBONG_DECISION_SCRIPT: JSON.stringify(entries) }
}
