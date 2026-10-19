// The Interest Profile (CONTEXT.md): the owner's circles as a topic list,
// each topic carrying the words that match it. A story matches a topic when
// any of its words appears in the title as a whole word or phrase; the match
// counts topics, not words, so a topic with many words weighs no more than
// one with few.

export interface NewsTopic {
  name: string
  words: string[]
}

export type InterestProfile = NewsTopic[]

/** The seven topics read from the owner's X follows on 2026-10-19. */
export function defaultInterestProfile(): InterestProfile {
  return [
    {
      name: 'AI coding agents and harnesses',
      words: ['claude code', 'codex', 'opencode', 'cursor', 'copilot', 'coding agent', 'coding agents', 'agentic', 'ai agent', 'ai agents', 'mcp', 'aider', 'windsurf', 'devin'],
    },
    {
      name: 'Frontier AI research',
      words: ['ai', 'llm', 'llms', 'gpt', 'openai', 'anthropic', 'claude', 'deepmind', 'gemini', 'karpathy', 'reinforcement learning', 'post-training', 'fine-tuning', 'transformer', 'deepseek', 'qwen', 'llama', 'mistral'],
    },
    {
      name: 'Developer tooling and terminal culture',
      words: ['neovim', 'vim', 'emacs', 'terminal', 'shell', 'tmux', 'zsh', 'typescript', 'javascript', 'react', 'electron', 'rust', 'zig', 'git', 'github', 'compiler', 'cli', 'linux', 'vs code', 'open source'],
    },
    {
      name: 'Startups, product and business',
      words: ['startup', 'startups', 'founder', 'founders', 'y combinator', 'yc', 'raises', 'funding', 'series a', 'acquires', 'acquisition', 'ipo', 'valuation', 'layoffs', 'saas'],
    },
    {
      name: 'Markets and finance',
      words: ['federal reserve', 'the fed', 'interest rates', 'inflation', 'recession', 'stock market', 'nasdaq', 's&p 500', 'market crash', 'tariffs', 'bitcoin', 'powell'],
    },
    {
      name: 'The Musk orbit',
      words: ['musk', 'elon', 'tesla', 'spacex', 'starship', 'starlink', 'xai', 'grok', 'neuralink'],
    },
    {
      name: 'One-offs',
      words: ['longevity', 'bryan johnson', 'chess', 'magnus carlsen', 'carlsen'],
    },
  ]
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether `word` appears in `text` as a whole word or phrase, any case. */
function contains(text: string, word: string): boolean {
  const trimmed = word.trim()
  if (trimmed === '') return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(trimmed)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)
}

/** The names of the topics `title` matches, in the profile's order. */
export function matchTopics(title: string, profile: InterestProfile): string[] {
  return profile.filter((topic) => topic.words.some((word) => contains(title, word))).map((topic) => topic.name)
}

/** Anything (disk, IPC) as a profile: topics with a name, their words trimmed and non-empty; not a list at all means the default. */
export function sanitizeInterestProfile(value: unknown): InterestProfile {
  if (!Array.isArray(value)) return defaultInterestProfile()
  const profile: InterestProfile = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { name, words } = item as { name?: unknown; words?: unknown }
    if (typeof name !== 'string' || name.trim() === '') continue
    const kept = Array.isArray(words) ? words.filter((word): word is string => typeof word === 'string').map((word) => word.trim()).filter(Boolean) : []
    profile.push({ name: name.trim(), words: kept })
  }
  return profile
}
