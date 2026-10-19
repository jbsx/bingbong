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

/** A count as the wall reads it from across the room: 42,036 is 42K, 104,657 is 104.7K. */
const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })

/** GitHub's own colour for the languages the month's list tends to hold; any other gets the quiet ink. */
const LANGUAGE_COLOURS: Record<string, string> = {
  Python: '#3572a5',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Rust: '#dea584',
  Go: '#00add8',
  'C++': '#f34b7d',
  C: '#555555',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  Ruby: '#701516',
  Shell: '#89e051',
  'Jupyter Notebook': '#da5b0b',
  Zig: '#ec915c',
  Dart: '#00b4ab',
  'C#': '#178600',
  PHP: '#4f5d95',
  Vue: '#41b883',
  HTML: '#e34c26',
  Lua: '#000080',
}

/** What a screen reader hears of a repository: its name, its line, its stars, and that a tap opens it. */
function spoken(repo: TopRepo, line: string): string {
  return `${repo.name}${line === '' ? '' : ` — ${line}`}, ${stars(repo.stars)} stars, ${stars(repo.starsThisMonth)} this month. Open it`
}

/**
 * The News card (CONTEXT.md), one tile: the Top Repos — the three
 * repositories that gained the most stars on GitHub this month, each a row
 * read from its figure: the stars it gained this month large at the left
 * with a bar measured against the leader's, so the order reads at a glance;
 * then its owner quiet and its name bold, GLM's one-sentence summary (the
 * repository's own description where none is written yet) on up to three
 * lines, and a quiet foot — the language behind GitHub's dot and the stars
 * in all. Each row is a tap that opens it; a row the box would cut is left
 * off whole, and a box too small for even the first sets every row lean —
 * the summary on one line.
 */
export function NewsCard({ repos }: { repos: TopRepo[] }) {
  const list = useRef<HTMLOListElement>(null)
  useWholeItems(list, repos, 'lean')
  const leader = Math.max(1, ...repos.map((repo) => repo.starsThisMonth))
  return (
    <section className="idle-card idle-news idle-repos" aria-label="news">
      <h3 className="idle-kicker">Top repos this month</h3>
      <ol ref={list}>
        {repos.map((repo) => {
          const [owner, name] = repo.name.split('/')
          const line = repo.summary ?? repo.description
          return (
            <li key={repo.name}>
              <button type="button" className="idle-repo" aria-label={spoken(repo, line)} {...opener(repo.link)}>
                <span className="idle-repo-gain">
                  <span className="idle-repo-gain-figure">+{compact.format(repo.starsThisMonth)}</span>
                  <span className="idle-repo-gain-label">this month</span>
                  <span className="idle-repo-bar" style={{ '--share': repo.starsThisMonth / leader } as React.CSSProperties} />
                </span>
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
                    {repo.language !== null ? (
                      <span className="idle-repo-language" style={{ '--language': LANGUAGE_COLOURS[repo.language] ?? 'var(--muted)' } as React.CSSProperties}>
                        {repo.language}
                      </span>
                    ) : null}
                    <span className="idle-repo-stars">★ {compact.format(repo.stars)}</span>
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
