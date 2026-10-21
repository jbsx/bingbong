import { useRef } from 'react'
import { compactStars, type TopRepo } from '../../core/news/topRepos'
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

/** The card's head, as round 6 draws it: "TOP REPOS" in small capitals, "★ this month" beside it. */
function NewsHead() {
  return (
    <h3 className="idle-kicker idle-news-head">
      Top repos <span className="idle-news-span">★ this month</span>
    </h3>
  )
}

/** The News card with no repos read yet: its head, and the note beside a quiet star. */
export function NewsEmpty() {
  return (
    <section className="idle-card idle-news idle-repos idle-news--empty" aria-label="news">
      <NewsHead />
      <p className="idle-news-none">
        <svg width={40} height={40} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.8 6.6 19.7l1.2-5.9L3.4 9.7l6-.7z" />
        </svg>
        No repos yet
      </p>
    </section>
  )
}

/**
 * The News card (CONTEXT.md), at the foot of the right Column: the Top Repos — the three
 * repositories that gained the most stars on GitHub this month, each a row
 * read from its figure: the stars it gained this month large at the left
 * with a bar measured against the leader's, so the order reads at a glance;
 * then its owner quiet and its name bold, GLM's one-sentence summary (the
 * repository's own description where none is written yet) on up to three
 * lines, and a quiet foot — the language behind GitHub's dot and the stars
 * in all; in a short band (`lean`) each row on one line, the gain, the name
 * and the stars. Each row is a tap that opens it; a row the box would cut is left
 * off whole, and a box too small for even the first sets every row lean —
 * the summary on one line.
 */
export function NewsCard({ repos, lean = false }: { repos: TopRepo[]; lean?: boolean }) {
  const list = useRef<HTMLOListElement>(null)
  useWholeItems(list, repos, 'lean')
  const leader = Math.max(1, ...repos.map((repo) => repo.starsThisMonth))
  return (
    <section className={lean ? 'idle-card idle-news idle-repos idle-repos--lean' : 'idle-card idle-news idle-repos'} aria-label="news">
      <NewsHead />
      <ol ref={list}>
        {repos.map((repo) => {
          const [owner, name] = repo.name.split('/')
          const line = repo.summary ?? repo.description
          return (
            <li key={repo.name}>
              <button type="button" className="idle-repo" aria-label={spoken(repo, line)} {...opener(repo.link)}>
                <span className="idle-repo-gain">
                  <span className="idle-repo-gain-figure">+{compactStars(repo.starsThisMonth)}</span>
                  <span className="idle-repo-gain-label">this month</span>
                  <span className="idle-repo-bar" style={{ '--share': repo.starsThisMonth / leader } as React.CSSProperties} />
                </span>
                <span className="idle-repo-words">
                  <span className="idle-repo-name">
                    <span className="idle-repo-owner">{owner}/</span>
                    {name}
                  </span>
                  {line !== '' ? (
                    <span className="idle-repo-line">
                      {line}
                    </span>
                  ) : null}
                  <span className="idle-repo-foot">
                    {repo.language !== null ? (
                      <span className="idle-repo-language" style={{ '--language': LANGUAGE_COLOURS[repo.language] ?? 'var(--fg2)' } as React.CSSProperties}>
                        {repo.language}
                      </span>
                    ) : null}
                    <span className="idle-repo-stars">★ {compactStars(repo.stars)}</span>
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
