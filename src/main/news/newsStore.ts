import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyNewsState, sanitizeNewsState, type NewsStore } from '../../core/news/newsDesk'
import { emptyTopReposState, sanitizeTopReposState, type TopReposStore } from '../../core/news/topRepos'
import { reportFault } from '../../core/trace/fault'

// The News Desk's persistence: news.json in userData, beside the Last Page.
// It holds the stories already shown (so "unseen" survives a restart), the
// sources' recent magnitudes and the last highlight. A missing or corrupt
// file is a desk that has shown nothing yet.

export function createNewsStore(path: string): NewsStore {
  return {
    load() {
      try {
        return sanitizeNewsState(JSON.parse(readFileSync(path, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('news.newsStore.load', error)
        return emptyNewsState()
      }
    },
    save(state) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      } catch (error) {
        reportFault('news.newsStore.save', error)
      }
    },
  }
}

/** The Top Repos' persistence: repos.json in userData, the last list read and its summaries, so a restart neither reads the page nor asks GLM again. */
export function createTopReposStore(path: string): TopReposStore {
  return {
    load() {
      try {
        return sanitizeTopReposState(JSON.parse(readFileSync(path, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('news.topReposStore.load', error)
        return emptyTopReposState()
      }
    },
    save(state) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      } catch (error) {
        reportFault('news.topReposStore.save', error)
      }
    },
  }
}
