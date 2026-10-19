import { reportFault } from '../trace/fault'

/**
 * One story on the News card (CONTEXT.md), whichever NewsSource it came
 * from. `magnitude` is the source's own measure of how big it is — points
 * on Hacker News, stars on GitHub — in `unit`; null on a feed, which
 * counts nothing (its `unit` is then '').
 */
export interface NewsStory {
  /** Unique across sources: the source's name and its own id. */
  readonly key: string
  readonly title: string
  readonly link: string
  /** The NewsSource's `name` it came from. */
  readonly source: string
  /** Epoch ms. */
  readonly publishedAt: number
  readonly magnitude: number | null
  readonly unit: string
  /** How many comments it drew, where the source counts them. */
  readonly comments: number | null
}

/**
 * Where stories come from (CONTEXT.md): one source is one site's public
 * listing. Asked for the stories published since a time, each with the
 * source's own magnitude.
 */
export interface NewsSource {
  readonly name: string
  stories(since: number): Promise<readonly NewsStory[]>
}

/**
 * A site refusing the appliance rather than failing: a rate limit, a bot
 * challenge, a network block. Asking again within the hour only deepens
 * it, so the News Desk rests the source for the day.
 */
export class NewsRefusal extends Error {
  override readonly name = 'NewsRefusal'
}

/**
 * Every source's stories published since `since`, whether any source
 * answered, and the sources that refused. A source that fails is reported
 * and left out, as a failing CalendarSource is — one site being down never
 * blanks the others.
 */
export async function gatherStories(
  sources: readonly NewsSource[],
  since: number,
): Promise<{ stories: NewsStory[]; answered: boolean; refused: string[] }> {
  const answers = await Promise.allSettled(sources.map((source) => source.stories(since)))
  const stories: NewsStory[] = []
  const refused: string[] = []
  let answered = false
  answers.forEach((answer, index) => {
    if (answer.status === 'rejected') {
      reportFault(`news.gatherStories.${sources[index].name}`, answer.reason)
      if (answer.reason instanceof NewsRefusal) refused.push(sources[index].name)
      return
    }
    answered = true
    for (const story of answer.value) if (story.publishedAt >= since) stories.push(story)
  })
  return { stories, answered, refused }
}

/** The story's site, as the card names it: "example.com"; empty when the link is not an address. */
export function hostOf(link: string): string {
  return URL.canParse(link) ? new URL(link).hostname.replace(/^www\./, '') : ''
}

/** The number that made it a story in its two parts, as the card sets them: "1,840" and "points"; none for a feed's post, which counts nothing. */
export function magnitudeParts(story: { magnitude: number | null; unit: string }): { count: string; unit: string } | null {
  if (story.magnitude === null) return null
  const count = Math.round(story.magnitude)
  return { count: count.toLocaleString('en-GB'), unit: count === 1 && story.unit.endsWith('s') ? story.unit.slice(0, -1) : story.unit }
}

/** Where the story stands, as one line read aloud: "1,840 points on Hacker News", or "on OpenAI" for a feed's post. */
export function magnitudeLabel(story: { magnitude: number | null; unit: string; source: string }): string {
  const parts = magnitudeParts(story)
  return parts === null ? `on ${story.source}` : `${parts.count} ${parts.unit} on ${story.source}`
}

/**
 * A story's title as the card sets it: the name it goes by, and the line
 * that says what it is where the title carries one. GitHub trending's
 * "owner/repo: description" becomes the repo's name over the description's
 * first sentence, so the card never shows a description cut off midway;
 * any other title is its own headline with no line under it.
 */
export function headline(title: string): { title: string; dek: string | null } {
  const repo = /^([\w.-]+\/[\w.-]+): (.+)$/s.exec(title)
  if (repo === null) return { title, dek: null }
  return { title: repo[1], dek: firstSentence(repo[2]) }
}

/** Up to the first full stop, question or exclamation mark that ends a sentence: one followed by a capital or a digit, not closing an abbreviation such as "e.g." or a single letter. */
function firstSentence(text: string): string {
  for (const end of text.matchAll(/[.!?](?=\s+[A-Z0-9])/g)) {
    const word = text.slice(0, end.index + 1).split(/\s/).pop() ?? ''
    if (/^\(?[A-Za-z]\.$/.test(word) || /\w\.\w/.test(word)) continue
    return text.slice(0, end.index + 1)
  }
  return text
}
