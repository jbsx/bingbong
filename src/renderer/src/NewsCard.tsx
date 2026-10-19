import { useRef } from 'react'
import type { TopRepo } from '../../core/news/topRepos'
import { useWholeItems } from './useFit'

/**
 * Opens a repository through the same `navigate` Command the words are, on
 * the pointer going down as the Last Page's card does: that pointer-down
 * also wakes the dashboard, so the pane shows it.
 */
function opener(link: string): { onPointerDown: () => void; onKeyDown: (event: React.KeyboardEvent) => void } {
  const open = (): void => {
    void window.bingbong.assistant.submit(`navigate ${link}`)
  }
  return {
    onPointerDown: open,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') open()
    },
  }
}

const stars = (n: number): string => n.toLocaleString('en-GB')

/** What a screen reader hears of a repository: its name, its line, its stars, and that a tap opens it. */
function spoken(repo: TopRepo, line: string): string {
  return `${repo.name}${line === '' ? '' : ` — ${line}`}, ${stars(repo.stars)} stars, ${stars(repo.starsThisMonth)} this month. Open it`
}

/**
 * The News card (CONTEXT.md), one tile: the Top Repos — the three
 * repositories that gained the most stars on GitHub this month, each a
 * numbered row: its owner quiet and its name bold, its stars in all in a
 * pill, then GLM's one-sentence summary (the repository's own description
 * where none is written yet), then its language and the stars it gained
 * this month, quiet. Each row is a tap that opens it; a row the box would
 * cut is left off whole, and a box too small for even the first sets
 * every row lean — the summary on one line, no foot.
 */
export function NewsCard({ repos }: { repos: TopRepo[] }) {
  const list = useRef<HTMLOListElement>(null)
  useWholeItems(list, repos, 'lean')
  return (
    <section className="idle-card idle-news idle-repos" aria-label="news">
      <h3 className="idle-kicker">Top repos this month</h3>
      <ol ref={list}>
        {repos.map((repo, index) => {
          const [owner, name] = repo.name.split('/')
          const line = repo.summary ?? repo.description
          return (
            <li key={repo.name}>
              <button type="button" className="idle-repo" aria-label={spoken(repo, line)} {...opener(repo.link)}>
                <span className="idle-repo-rank">{index + 1}</span>
                <span className="idle-repo-words">
                  <span className="idle-repo-name">
                    <span className="idle-repo-owner">{owner}/</span>
                    {name}
                  </span>
                  {line !== '' ? (
                    <span className="idle-repo-line" data-summary={repo.summary !== null ? '' : undefined}>
                      {line}
                    </span>
                  ) : null}
                  <span className="idle-repo-foot">
                    {repo.language !== null ? `${repo.language} · ` : ''}+{stars(repo.starsThisMonth)} this month
                  </span>
                </span>
                <span className="idle-repo-stars">★ {stars(repo.stars)}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
