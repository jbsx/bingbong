import { reportFault } from '../trace/fault'

/**
 * One story on the News card (CONTEXT.md), whichever NewsSource it came
 * from. `magnitude` is the source's own measure of how big it is — points
 * on Hacker News, stars on GitHub — in `unit`.
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
  readonly magnitude: number
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
 * Every source's stories published since `since`, and whether any source
 * answered. A source that fails is reported and left out, as a failing
 * CalendarSource is — one site being down never blanks the others.
 */
export async function gatherStories(sources: readonly NewsSource[], since: number): Promise<{ stories: NewsStory[]; answered: boolean }> {
  const answers = await Promise.allSettled(sources.map((source) => source.stories(since)))
  const stories: NewsStory[] = []
  let answered = false
  answers.forEach((answer, index) => {
    if (answer.status === 'rejected') {
      reportFault(`news.gatherStories.${sources[index].name}`, answer.reason)
      return
    }
    answered = true
    for (const story of answer.value) if (story.publishedAt >= since) stories.push(story)
  })
  return { stories, answered }
}

/** The story's site, as the card names it: "example.com"; empty when the link is not an address. */
export function hostOf(link: string): string {
  return URL.canParse(link) ? new URL(link).hostname.replace(/^www\./, '') : ''
}

/** The number that made it a story in its two parts, as the card sets them: "1,840" and "points". */
export function magnitudeParts(story: Pick<NewsStory, 'magnitude' | 'unit'>): { count: string; unit: string } {
  const count = Math.round(story.magnitude)
  return { count: count.toLocaleString('en-GB'), unit: count === 1 && story.unit.endsWith('s') ? story.unit.slice(0, -1) : story.unit }
}

/** The number that made it a story, as one line: "1,840 points". */
export function magnitudeLabel(story: Pick<NewsStory, 'magnitude' | 'unit'>): string {
  const { count, unit } = magnitudeParts(story)
  return `${count} ${unit}`
}
