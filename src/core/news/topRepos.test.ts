import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compactStars, createTopReposDesk, emptyTopReposState, readmeText, readmeUrl, readSummaries, readTrendingMonth, sanitizeTopReposState, summaryAsk, TOP_REPOS_REFRESH_MS, TOP_REPOS_URL, type RepoSummaryWriter, type TopReposState } from './topRepos'

// github.com/trending?since=monthly as it answered on 2026-10-19, cut to four repositories.
const PAGE = readFileSync(new URL('./fixtures/github-trending-monthly.html', import.meta.url), 'utf8')

function memoryStore(initial: TopReposState = emptyTopReposState()) {
  const saves: TopReposState[] = []
  let state = initial
  return {
    saves,
    load: () => state,
    save: (next: TopReposState) => {
      state = next
      saves.push(next)
    },
  }
}

describe('readTrendingMonth', () => {
  it('reads every repository, the most stars this month first, with its stars in all', () => {
    const repos = readTrendingMonth(PAGE)
    expect(repos.map((repo) => [repo.name, repo.starsThisMonth, repo.stars])).toEqual([
      ['debpalash/VoiceStudio', 42036, 77289],
      ['vectorize-io/hindsight', 27550, 51625],
      ['paperclipai/paperclip', 23340, 104655],
      ['heygen-com/hyperframes', 15429, 67542],
    ])
    expect(repos[2]).toMatchObject({ link: 'https://github.com/paperclipai/paperclip', language: 'TypeScript' })
    expect(repos[2].description).not.toBe('')
  })

  it('throws on a page with no repositories', () => {
    expect(() => readTrendingMonth('<html></html>')).toThrow()
  })
})

describe('summaries', () => {
  const repos = readTrendingMonth(PAGE).slice(0, 2)

  it('asks with each repository numbered, its name, description, language and README opening', () => {
    const ask = summaryAsk([
      { ...repos[0], readme: 'A studio for voices.' },
      { ...repos[1], readme: null },
    ])
    expect(ask).toContain('Repository 1\nName: debpalash/VoiceStudio\nDescription: ')
    expect(ask).toContain('Language: Python\nREADME opening: A studio for voices.')
    expect(ask).toContain('Repository 2\nName: vectorize-io/hindsight')
    expect(ask.match(/README opening/g)).toHaveLength(1)
  })

  it('reads a README as its opening text, without code, images, badges or link targets', () => {
    const markdown = '<!-- top -->\n<p align="center"><img src="logo.png"></p>\n\n# Hindsight\n\n[![CI](https://x/badge.svg)](https://x)\n\n**Agent memory** that [learns](https://docs). \n\n```bash\npip install hindsight\n```\n\n## Why\n> Fast.'
    expect(readmeText(markdown)).toBe('Hindsight Agent memory that learns. Why Fast.')
    expect(readmeText('word '.repeat(400)).length).toBe(1201)
  })

  it('reads a fenced reply by number, leaving out a missing or overlong line', () => {
    expect(readSummaries(`\`\`\`json\n{"1": "  A local voice studio.  ", "2": "${'x'.repeat(200)}"}\n\`\`\``, repos)).toEqual({ 'debpalash/VoiceStudio': 'A local voice studio.' })
    expect(readSummaries('no json', repos)).toEqual({})
  })

  it('keeps only well-formed state from the file', () => {
    expect(sanitizeTopReposState({ fetchedAt: 5, repos: [{ name: 'a/b' }, repos[0]], summaries: { 'a/b': 'Fine.', bad: 3 } })).toEqual({ fetchedAt: 5, repos: [repos[0]], summaries: { 'a/b': 'Fine.' } })
    expect(sanitizeTopReposState(null)).toEqual(emptyTopReposState())
  })
})

describe('createTopReposDesk', () => {
  it('shows the top three with GLM’s summaries, reading the page at most once a refresh', async () => {
    let at = 1_000_000
    const asked: string[] = []
    const written: string[][] = []
    const writer: RepoSummaryWriter = {
      async write(repos) {
        written.push(repos.map((repo) => repo.name))
        return Object.fromEntries(repos.map((repo) => [repo.name, `About ${repo.name}.`]))
      },
    }
    const store = memoryStore()
    const told: (string | null)[] = []
    const desk = createTopReposDesk({
      fetchText: async (url) => {
        asked.push(url)
        if (url === readmeUrl('vectorize-io/hindsight')) throw new Error('404')
        return url === TOP_REPOS_URL ? PAGE : `# ${url}\n\nIt does a thing.`
      },
      store,
      writer: () => ({
        write(repos) {
          told.push(...repos.map((repo) => repo.readme))
          return writer.write(repos)
        },
      }),
      now: () => at,
    })
    const repos = await desk.repos()
    expect(repos?.map((repo) => [repo.name, repo.summary])).toEqual([
      ['debpalash/VoiceStudio', 'About debpalash/VoiceStudio.'],
      ['vectorize-io/hindsight', 'About vectorize-io/hindsight.'],
      ['paperclipai/paperclip', 'About paperclipai/paperclip.'],
    ])
    expect(asked).toEqual([TOP_REPOS_URL, readmeUrl('debpalash/VoiceStudio'), readmeUrl('vectorize-io/hindsight'), readmeUrl('paperclipai/paperclip')])
    // A README that fails leaves only the description told.
    expect(told).toEqual([`${readmeUrl('debpalash/VoiceStudio')} It does a thing.`, null, `${readmeUrl('paperclipai/paperclip')} It does a thing.`])
    expect(written).toHaveLength(1)
    at += TOP_REPOS_REFRESH_MS - 1
    await desk.repos()
    expect(asked).toHaveLength(4)
    expect(store.saves).toHaveLength(1)
    at += 1
    await desk.repos()
    expect(asked).toHaveLength(5)
    // The same three already have their summaries: none asked again.
    expect(written).toHaveLength(1)
  })

  it('keeps the last list through a failed read, and with no writer shows no summaries', async () => {
    let at = 0
    let fail = false
    const desk = createTopReposDesk({
      fetchText: async () => {
        if (fail) throw new Error('offline')
        return PAGE
      },
      store: memoryStore(),
      writer: () => null,
      now: () => at,
    })
    expect((await desk.repos())?.map((repo) => repo.summary)).toEqual([null, null, null])
    fail = true
    at += TOP_REPOS_REFRESH_MS
    expect((await desk.repos())?.map((repo) => repo.name)).toEqual(['debpalash/VoiceStudio', 'vectorize-io/hindsight', 'paperclipai/paperclip'])
  })

  it('answers null before any list was read, and asks a failing writer at most once a refresh', async () => {
    let at = 0
    let writes = 0
    const failing: RepoSummaryWriter = {
      async write() {
        writes += 1
        throw new Error('429')
      },
    }
    let page = '<html></html>'
    const desk = createTopReposDesk({ fetchText: async () => page, store: memoryStore(), writer: () => failing, now: () => at })
    expect(await desk.repos()).toBeNull()
    page = PAGE
    at += 1
    await desk.repos()
    at += 1
    await desk.repos()
    expect(writes).toBe(1)
    at += TOP_REPOS_REFRESH_MS
    await desk.repos()
    expect(writes).toBe(2)
  })
})

describe('compactStars', () => {
  it('keeps one decimal past a thousand, so a column of gains lines up', () => {
    expect(compactStars(42_036)).toBe('42.0k')
    expect(compactStars(27_612)).toBe('27.6k')
    expect(compactStars(104_657)).toBe('104.7k')
    expect(compactStars(1_000)).toBe('1.0k')
    expect(compactStars(2_000_000)).toBe('2.0m')
  })

  it('writes a count under a thousand as itself', () => {
    expect(compactStars(850)).toBe('850')
    expect(compactStars(0)).toBe('0')
  })
})
