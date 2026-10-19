import { ipcMain } from 'electron'
import { resolveBriefWriterRouting } from '../../core/news/briefWriterRouting'
import { NEWS_IPC } from '../../core/news/ipcChannels'
import { createTopReposDesk, type RepoSummaryWriter } from '../../core/news/topRepos'
import { createRepoSummaryWriter } from './briefWriter'
import { createTopReposStore } from './newsStore'

/**
 * The e2e's stand-in for GitHub: with BINGBONG_NEWS_FIXTURE set to a local
 * server's origin, the trending page and the READMEs are asked of that
 * server at the same path and query instead. Test support only: nothing sets it outside the
 * e2e harness.
 */
export const NEWS_FIXTURE_ENV = 'BINGBONG_NEWS_FIXTURE'

/** Long enough for a slow GitHub; short enough that a dead one never stacks reads. */
const REQUEST_TIMEOUT_MS = 10_000

const USER_AGENT = 'BingBong/1.0 (Idle Screen news card; one request an hour)'

/** The summary writer for the env as it stands, one kept while its endpoint is unchanged; none without a key. */
function summaryWriterSource(currentEnv: () => Record<string, string | undefined>): () => RepoSummaryWriter | null {
  let held: { signature: string; writer: RepoSummaryWriter } | null = null
  return () => {
    const endpoint = resolveBriefWriterRouting(currentEnv())
    if (endpoint === null) return null
    const signature = `${endpoint.baseUrl} ${endpoint.model} ${endpoint.apiKey}`
    if (held?.signature !== signature) held = { signature, writer: createRepoSummaryWriter(endpoint) }
    return held.writer
  }
}

/**
 * The News card's IPC (CONTEXT.md): the Idle Screen asks for the Top Repos
 * and main's desk answers, reading GitHub's monthly trending page at most
 * hourly. Each repository's one-line summary is written by GLM when
 * `currentEnv` carries its key (briefWriterRouting); without one the card
 * shows the repositories' own descriptions.
 */
export function registerNewsIpc(deps: {
  storePath: string
  /** The live env (.env, process, settings), read at every refresh for the writer's key. */
  currentEnv: () => Record<string, string | undefined>
  env?: NodeJS.ProcessEnv
}): void {
  const fixture = (deps.env ?? process.env)[NEWS_FIXTURE_ENV]?.trim().replace(/\/+$/, '')
  const rebase = (url: string): string => {
    if (!fixture) return url
    const { pathname, search } = new URL(url)
    return `${fixture}${pathname}${search}`
  }
  const desk = createTopReposDesk({
    async fetchText(url) {
      const response = await fetch(rebase(url), { headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`)
      return response.text()
    },
    store: createTopReposStore(deps.storePath),
    writer: summaryWriterSource(deps.currentEnv),
  })
  ipcMain.handle(NEWS_IPC.repos, () => desk.repos())
}
