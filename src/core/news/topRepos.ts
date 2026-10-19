import { reportFault } from '../trace/fault'
import { textOf } from './markup'

// Top Repos (CONTEXT.md): the News card's one tile, by the owner's ruling
// (2026-10-19) that Today's Highlight and Big News said too little — the
// three repositories that gained the most stars on GitHub this month, each
// with one short sentence GLM writes of what it is and the stars it has in
// all. GitHub's monthly trending page is read for them, since no API
// answers it; the page does not list them by the month's stars, so they are
// sorted here.

/** GitHub's trending page over the month. */
export const TOP_REPOS_URL = 'https://github.com/trending?since=monthly'

/** How many repositories the card shows. */
export const TOP_REPOS_COUNT = 3

/** How often the page is read again: the month's list moves slowly, and GitHub is asked no more than the other sources were. */
export const TOP_REPOS_REFRESH_MS = 60 * 60 * 1000

/** One repository as the trending page lists it. */
export interface TrendingRepo {
  /** `owner/name`. */
  name: string
  link: string
  /** The repository's own description; empty where it set none. */
  description: string
  language: string | null
  /** Its stars in all. */
  stars: number
  /** The stars it gained this month, which rank it. */
  starsThisMonth: number
}

/** A repository on the card: its summary where GLM has written one. */
export interface TopRepo extends TrendingRepo {
  summary: string | null
}

function count(text: string | undefined): number | null {
  if (text === undefined) return null
  const value = Number(text.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/** One `<article class="Box-row">` as a repository, or null when it is not one with a month's stars. */
function repoOf(article: string): TrendingRepo | null {
  const repo = /<h2[^>]*>\s*<a[^>]*href="\/([^"/]+\/[^"/]+)"/.exec(article)?.[1]
  const starsThisMonth = count(/([\d,]+)\s+stars?\s+this month/.exec(article)?.[1])
  if (repo === undefined || starsThisMonth === null) return null
  const name = decodeURIComponent(repo)
  return {
    name,
    link: `https://github.com/${name}`,
    description: textOf(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/.exec(article)?.[1] ?? ''),
    language: /itemprop="programmingLanguage">([^<]+)</.exec(article)?.[1]?.trim() ?? null,
    stars: count(/href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/.exec(article)?.[1]) ?? starsThisMonth,
    starsThisMonth,
  }
}

/** The monthly trending page as its repositories, the most stars this month first; a page with none throws, as GitHub changing its markup would. */
export function readTrendingMonth(page: string): TrendingRepo[] {
  const repos = page
    .split('<article class="Box-row"')
    .slice(1)
    .map(repoOf)
    .filter((repo): repo is TrendingRepo => repo !== null)
  if (repos.length === 0) throw new Error('GitHub answered no trending repositories')
  return repos.sort((a, b) => b.starsThisMonth - a.starsThisMonth)
}

/** A repository's README, where it has one at the default branch's root. */
export const readmeUrl = (name: string): string => `https://raw.githubusercontent.com/${name}/HEAD/README.md`

/** How much of a README's text the writer is shown: its opening says what the project is; the rest is install steps. */
const README_MAX = 1200

/** A README's opening as plain text: code, images, badges, tags and link targets dropped, headings and emphasis unmarked. */
export function readmeText(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  const plain = textOf(text)
    .replace(/(^|\s)#{1,6}\s/g, '$1')
    .replace(/[*_`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > README_MAX ? `${plain.slice(0, README_MAX)}…` : plain
}

/** What the writer is told of one repository: the trending page's facts and its README's opening, where read. */
export interface RepoFacts extends TrendingRepo {
  readme: string | null
}

/** The writer of the repositories' one-line summaries: the ones it could write, by repository name. */
export interface RepoSummaryWriter {
  write(repos: readonly RepoFacts[]): Promise<Record<string, string>>
}

/** The longest summary kept: one past it is not the short sentence asked for, so the card shows the description. */
export const SUMMARY_MAX = 110

/** How much of a description the writer is shown. */
const DESCRIPTION_MAX = 400

/** The instructions, the same for every ask. */
export const SUMMARY_INSTRUCTIONS = [
  'You write the one line under each GitHub repository on a card on the owner\'s wall display, read from across the room.',
  'For each repository write one short sentence, at most 12 words, saying what it is or does in plain words a busy developer gets at a glance.',
  'Say what makes it different, from its description and the opening of its README. Do not repeat the repository\'s name; no hype words; no star counts; name the language only where it is the point.',
  'Use only the facts given. Never invent a feature or a claim. Where the facts say little, say less.',
  'Answer with JSON only: an object whose keys are the repository numbers as strings, each value the sentence.',
].join('\n')

/** The ask's user message: every repository's facts, one a line, so nothing reads as an instruction. */
export function summaryAsk(repos: readonly RepoFacts[]): string {
  return repos
    .map((repo, index) => {
      const description = repo.description.length > DESCRIPTION_MAX ? `${repo.description.slice(0, DESCRIPTION_MAX)}…` : repo.description
      return [
        `Repository ${index + 1}`,
        `Name: ${repo.name}`,
        `Description: ${description === '' ? 'none given' : description}`,
        ...(repo.language === null ? [] : [`Language: ${repo.language}`]),
        ...(repo.readme === null || repo.readme === '' ? [] : [`README opening: ${repo.readme}`]),
      ].join('\n')
    })
    .join('\n\n')
}

function sentence(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' || text.length > SUMMARY_MAX ? null : text
}

/** The model's reply as summaries by repository name: a fenced or bare JSON object; a repository whose line is missing, empty or too long is left out. */
export function readSummaries(reply: string, repos: readonly TrendingRepo[]): Record<string, string> {
  const body = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (body === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    // A reply that is no JSON writes nothing; the repositories are asked about again at the next refresh.
    reportFault('news.topRepos.readSummaries', error)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const summaries: Record<string, string> = {}
  repos.forEach((repo, index) => {
    const line = sentence((parsed as Record<string, unknown>)[String(index + 1)])
    if (line !== null) summaries[repo.name] = line
  })
  return summaries
}

/** What repos.json keeps: the last list read, when, and the summaries written for it. */
export interface TopReposState {
  fetchedAt: number
  repos: TrendingRepo[]
  summaries: Record<string, string>
}

export interface TopReposStore {
  load(): TopReposState
  save(state: TopReposState): void
}

export function emptyTopReposState(): TopReposState {
  return { fetchedAt: 0, repos: [], summaries: {} }
}

function repoFrom(raw: unknown): TrendingRepo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || typeof r.link !== 'string' || typeof r.description !== 'string') return null
  if (typeof r.stars !== 'number' || typeof r.starsThisMonth !== 'number') return null
  return { name: r.name, link: r.link, description: r.description, language: typeof r.language === 'string' ? r.language : null, stars: r.stars, starsThisMonth: r.starsThisMonth }
}

/** Anything (the file in userData) as a state: well-formed entries only. */
export function sanitizeTopReposState(raw: unknown): TopReposState {
  if (typeof raw !== 'object' || raw === null) return emptyTopReposState()
  const r = raw as Record<string, unknown>
  const repos = Array.isArray(r.repos) ? r.repos.map(repoFrom).filter((repo): repo is TrendingRepo => repo !== null) : []
  const summaries: Record<string, string> = {}
  if (typeof r.summaries === 'object' && r.summaries !== null && !Array.isArray(r.summaries)) {
    for (const [name, value] of Object.entries(r.summaries)) {
      const line = sentence(value)
      if (line !== null) summaries[name] = line
    }
  }
  return { fetchedAt: typeof r.fetchedAt === 'number' ? r.fetchedAt : 0, repos, summaries }
}

export interface TopReposDesk {
  /** The month's top repositories, each with its summary where written; null when the page has never been read. */
  repos(): Promise<TopRepo[] | null>
}

/**
 * The Top Repos desk: the trending page read at most every refresh, the
 * top three kept (the last list held through a failed read), and a summary
 * asked of `writer` for each of them that has none — at most once a
 * refresh, so a writer that fails is not asked at every look. With no
 * writer (no key) the card shows the descriptions.
 */
export function createTopReposDesk(deps: {
  fetchText: (url: string) => Promise<string>
  store: TopReposStore
  writer: () => RepoSummaryWriter | null
  now?: () => number
}): TopReposDesk {
  const now = deps.now ?? Date.now
  let state = deps.store.load()
  let wroteAt = Number.NEGATIVE_INFINITY
  let inFlight: Promise<void> | null = null

  async function refresh(): Promise<void> {
    const at = now()
    let next = state
    if (at - state.fetchedAt >= TOP_REPOS_REFRESH_MS || state.repos.length === 0) {
      try {
        next = { ...next, fetchedAt: at, repos: readTrendingMonth(await deps.fetchText(TOP_REPOS_URL)).slice(0, TOP_REPOS_COUNT) }
      } catch (error) {
        // The card keeps the last list; the page is read again at the next look past the refresh.
        reportFault('news.topRepos.fetch', error)
        next = { ...next, fetchedAt: at }
      }
    }
    // Only the shown repositories' summaries are kept.
    const summaries = Object.fromEntries(next.repos.flatMap((repo) => (next.summaries[repo.name] === undefined ? [] : [[repo.name, next.summaries[repo.name]]])))
    const wanted = next.repos.filter((repo) => summaries[repo.name] === undefined)
    const writer = wanted.length > 0 && at - wroteAt >= TOP_REPOS_REFRESH_MS ? deps.writer() : null
    if (writer !== null) {
      wroteAt = at
      try {
        // A README that will not come is no reason to hold the summary: the description is still told.
        const facts = await Promise.all(
          wanted.map(async (repo): Promise<RepoFacts> => ({
            ...repo,
            readme: await deps.fetchText(readmeUrl(repo.name)).then(readmeText, () => null),
          })),
        )
        Object.assign(summaries, await writer.write(facts))
      } catch (error) {
        reportFault('news.topRepos.write', error)
      }
    }
    next = { ...next, summaries }
    const changed = JSON.stringify(next) !== JSON.stringify(state)
    state = next
    if (changed) deps.store.save(state)
  }

  return {
    async repos() {
      inFlight ??= refresh().finally(() => {
        inFlight = null
      })
      await inFlight
      if (state.repos.length === 0) return null
      return state.repos.map((repo) => ({ ...repo, summary: state.summaries[repo.name] ?? null }))
    },
  }
}
