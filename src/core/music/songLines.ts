// What is said of a song that cannot be opened: the Command's failure, and
// the queued song passed over with no Command to say it (#538).

/** A song's title as a line names it. */
export const quoted = (title: string): string => `“${title}”`

/** A song that could not be opened, its failure's first sentence (ui.md 9). */
export const cantBePlayedLine = (title: string): string => `${quoted(title)} can't be played.`

/**
 * A queued song passed over at the end of the song before it, said once per
 * song. Its second sentence names a line that works (ui.md 10): a `play` from
 * a Command falls back to the watch page and shows it.
 * A guess (#538, ruling 5): no measure reaches spoken wording; the owner's
 * next report on this sentence settles it.
 */
export const passedOverLine = (title: string): string => `${cantBePlayedLine(title)} Say play and its name to open its page.`
