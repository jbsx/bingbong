import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyNewsState, type NewsState, type NewsStore } from '../../core/news/newsDesk'
import { reportFault } from '../../core/trace/fault'

// The News Desk's persistence: news.json in userData, beside the Last Page.
// It holds the stories already shown (so "unseen" survives a restart), the
// sources' recent magnitudes and the last highlight. A missing or corrupt
// file is a desk that has shown nothing yet.

function asState(raw: unknown): NewsState {
  const record = typeof raw === 'object' && raw !== null ? (raw as Partial<NewsState>) : {}
  const shown = Array.isArray(record.shown)
    ? record.shown.filter((entry): entry is NewsState['shown'][number] => typeof entry?.key === 'string' && typeof entry?.at === 'number')
    : []
  const history = typeof record.history === 'object' && record.history !== null ? record.history : {}
  const highlight = typeof record.highlight?.story?.key === 'string' ? record.highlight : null
  return { shown, history, highlight }
}

export function createNewsStore(path: string): NewsStore {
  return {
    load() {
      try {
        return asState(JSON.parse(readFileSync(path, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('news.newsStore.load', error)
        return emptyNewsState()
      }
    },
    save(state) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify(state)}\n`, 'utf8')
      } catch (error) {
        reportFault('news.newsStore.save', error)
      }
    },
  }
}
