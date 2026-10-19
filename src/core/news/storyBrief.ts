import { reportFault } from '../trace/fault'
import { hostOf, magnitudeLabel } from './news'

// Story Brief (CONTEXT.md): the two lines a generating model writes for
// each story the News card shows — what it is, in plain words, and why it
// is worth the owner's attention — from the facts the sources gave and the
// reasons the desk picked it. Written once per story after a poll, off the
// card's path: a story whose brief has not come back, or never will, shows
// its headline as before. The owner's ruling (2026-10-19): the Command
// path stays Jev-only to stay snappy; the News card is asynchronous, so a
// slower model may write for it.

/** The two lines, each a short sentence. */
export interface StoryBrief {
  what: string
  why: string
}

/** Everything the writer is told about one story: nothing it is not told may appear in the brief. */
export interface BriefStory {
  key: string
  title: string
  source: string
  link: string
  /** What the source says the story is — a repo's description, a model's task and tags, a paper's abstract; none for a headline that is all there is. */
  about: string | null
  magnitude: number | null
  unit: string
  /** The Interest Profile topics it matched, and the words in it that matched them. */
  topics: string[]
  words: string[]
  /** Every source carrying the same story, its own first. */
  sources: string[]
}

/** The writer: the briefs it could write, by story key; a story it could not is left out. */
export interface StoryBriefWriter {
  write(stories: readonly BriefStory[]): Promise<Record<string, StoryBrief>>
}

/** The briefs kept in news.json, by story key. */
export type StoryBriefs = Record<string, StoryBrief>

/** The longest line kept: a line past it is not the short sentence asked for, so the story keeps its headline. */
export const BRIEF_LINE_MAX = 110

/** How much of a story's `about` the writer is shown: a paper's whole abstract says no more for the length. */
const ABOUT_MAX = 600

/** One story as the writer reads it, numbered: one fact a line, so nothing reads as an instruction. */
function storyFacts(story: BriefStory, index: number): string {
  const about = story.about === null ? null : story.about.length > ABOUT_MAX ? `${story.about.slice(0, ABOUT_MAX)}…` : story.about
  const host = hostOf(story.link)
  return [
    `Story ${index + 1}`,
    `Title: ${story.title}`,
    ...(about === null ? [] : [`About: ${about}`]),
    `Size: ${magnitudeLabel(story)}`,
    ...(host === '' ? [] : [`Site: ${host}`]),
    ...(story.sources.length > 1 ? [`Also on: ${story.sources.slice(1).join(', ')}`] : []),
    `Owner's topics it matched: ${story.topics.length === 0 ? 'none' : story.topics.join('; ')}`,
    ...(story.words.length === 0 ? [] : [`Words in it that matched: ${story.words.join(', ')}`]),
  ].join('\n')
}

/** The instructions, the same for every ask. */
export const BRIEF_INSTRUCTIONS = [
  'You write the two lines under each story on a news card on the owner\'s wall display, read from across the room.',
  'For each story write:',
  '- "what": what the thing is or what happened, in plain words a busy developer gets at a glance. At most 12 words. Do not repeat the name or title; no hype words.',
  '- "why": the strongest reason it is worth the owner\'s attention, at most 12 words: the specific thing in it the owner follows (the matched words, said plainly), how big it is on its source, the other sources carrying it.',
  'The "why" says only what makes it notable: never what it lacks, never that it is small, and never the words "topic", "interest" or "matched".',
  'Use only the facts given. Never invent a number, a feature or a claim. Where the facts say little, say less.',
  'Answer with JSON only: an object whose keys are the story numbers as strings, each {"what": "...", "why": "..."}.',
].join('\n')

/** The ask's user message: every story's facts. */
export function briefAsk(stories: readonly BriefStory[]): string {
  return stories.map(storyFacts).join('\n\n')
}

function line(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' || text.length > BRIEF_LINE_MAX ? null : text
}

/** The model's reply as briefs by story key: a fenced or bare JSON object, read per story; a story whose lines are missing, empty or too long is left out. */
export function readBriefs(reply: string, stories: readonly BriefStory[]): Record<string, StoryBrief> {
  const body = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (body === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    // A reply that is no JSON writes nothing; the stories are asked about again at the next poll.
    reportFault('news.storyBriefs.read', error)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const briefs: Record<string, StoryBrief> = {}
  stories.forEach((story, index) => {
    const entry = (parsed as Record<string, unknown>)[String(index + 1)]
    if (typeof entry !== 'object' || entry === null) return
    const what = line((entry as Record<string, unknown>).what)
    const why = line((entry as Record<string, unknown>).why)
    if (what !== null && why !== null) briefs[story.key] = { what, why }
  })
  return briefs
}

/** Anything (the file in userData) as kept briefs: well-formed entries only. */
export function sanitizeStoryBriefs(raw: unknown): StoryBriefs {
  const briefs: StoryBriefs = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return briefs
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null) continue
    const what = line((entry as Record<string, unknown>).what)
    const why = line((entry as Record<string, unknown>).why)
    if (what !== null && why !== null) briefs[key] = { what, why }
  }
  return briefs
}

/**
 * The kept briefs with one for every story in `shown` that has none,
 * asked of `writer` in one go, and only the briefs of `keep` (the stories
 * the history still holds). A writer that fails is reported and leaves the
 * stories unbriefed, to be asked again at the next poll.
 */
export async function gatherStoryBriefs(briefs: StoryBriefs, shown: readonly BriefStory[], writer: StoryBriefWriter, keep: ReadonlySet<string>): Promise<StoryBriefs> {
  const next: StoryBriefs = Object.fromEntries(Object.entries(briefs).filter(([key]) => keep.has(key)))
  const wanted = shown.filter((story) => next[story.key] === undefined)
  if (wanted.length === 0) return next
  try {
    const written = await writer.write(wanted)
    for (const story of wanted) if (written[story.key] !== undefined) next[story.key] = written[story.key]
  } catch (error) {
    reportFault('news.storyBriefs.write', error)
  }
  return next
}
