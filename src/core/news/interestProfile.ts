import type { NewsStory } from './news'
import { redditSourceName, subredditOf } from './reddit'

// The Interest Profile (CONTEXT.md): the owner's circles as a topic list,
// each topic carrying the words that match it and the subreddits polled for
// it. A story matches a topic when any of its words appears in the title as
// a whole word or phrase, or when it came from one of the topic's
// subreddits; the match counts topics, not words, so a topic with many
// words weighs no more than one with few.

export interface NewsTopic {
  name: string
  words: string[]
  /** The subreddits polled for it (#348), each its own NewsSource; none polls none. */
  subreddits: string[]
}

export type InterestProfile = NewsTopic[]

/** The seven topics read from the owner's X follows on 2026-10-19, with one or two subreddits each. */
export function defaultInterestProfile(): InterestProfile {
  return [
    {
      name: 'AI coding agents and harnesses',
      words: ['claude code', 'codex', 'opencode', 'cursor', 'copilot', 'coding agent', 'coding agents', 'agentic', 'ai agent', 'ai agents', 'mcp', 'aider', 'windsurf', 'devin'],
      subreddits: ['ClaudeAI', 'ChatGPTCoding'],
    },
    {
      name: 'Frontier AI research',
      words: ['ai', 'llm', 'llms', 'gpt', 'openai', 'anthropic', 'claude', 'deepmind', 'gemini', 'karpathy', 'reinforcement learning', 'post-training', 'fine-tuning', 'transformer', 'deepseek', 'qwen', 'llama', 'mistral'],
      subreddits: ['LocalLLaMA', 'MachineLearning'],
    },
    {
      name: 'Developer tooling and terminal culture',
      words: ['neovim', 'vim', 'emacs', 'terminal', 'shell', 'tmux', 'zsh', 'typescript', 'javascript', 'react', 'electron', 'rust', 'zig', 'git', 'github', 'compiler', 'cli', 'linux', 'vs code', 'open source'],
      subreddits: ['neovim', 'programming'],
    },
    {
      name: 'Startups, product and business',
      words: ['startup', 'startups', 'founder', 'founders', 'y combinator', 'yc', 'raises', 'funding', 'series a', 'acquires', 'acquisition', 'ipo', 'valuation', 'layoffs', 'saas'],
      subreddits: ['startups'],
    },
    {
      name: 'Markets and finance',
      words: ['federal reserve', 'the fed', 'interest rates', 'inflation', 'recession', 'stock market', 'nasdaq', 's&p 500', 'market crash', 'tariffs', 'bitcoin', 'powell'],
      subreddits: ['wallstreetbets'],
    },
    {
      name: 'The Musk orbit',
      words: ['musk', 'elon', 'tesla', 'spacex', 'starship', 'starlink', 'xai', 'grok', 'neuralink'],
      subreddits: ['teslamotors', 'SpaceX'],
    },
    {
      name: 'One-offs',
      words: ['longevity', 'bryan johnson', 'chess', 'magnus carlsen', 'carlsen'],
      subreddits: ['chess'],
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

/** The names of the topics a story matches, in the profile's order: by its title's words, or by the subreddit it came from. */
export function storyTopics(story: Pick<NewsStory, 'title' | 'source'>, profile: InterestProfile): string[] {
  return profile
    .filter((topic) => topic.words.some((word) => contains(story.title, word)) || topic.subreddits.some((subreddit) => redditSourceName(subreddit) === story.source))
    .map((topic) => topic.name)
}

/** Every distinct subreddit the profile polls, as typed first; one typed as no name ("r/") polls none. */
export function profileSubreddits(profile: InterestProfile): string[] {
  const seen = new Map<string, string>()
  for (const topic of profile) {
    for (const subreddit of topic.subreddits) if (subredditOf(subreddit) !== '' && !seen.has(redditSourceName(subreddit))) seen.set(redditSourceName(subreddit), subreddit)
  }
  return [...seen.values()]
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((word): word is string => typeof word === 'string').map((word) => word.trim()).filter(Boolean) : []
}

/**
 * Anything (disk, IPC) as a profile: topics with a name, their words and
 * subreddits trimmed and non-empty; not a list at all means the default. A
 * topic saved before subreddits existed (#346) takes the default topic's of
 * the same name, so an owner's profile starts polling Reddit without
 * re-entering it; one saved with an empty list polls none.
 */
export function sanitizeInterestProfile(value: unknown): InterestProfile {
  if (!Array.isArray(value)) return defaultInterestProfile()
  const defaults = new Map(defaultInterestProfile().map((topic) => [topic.name, topic.subreddits]))
  const profile: InterestProfile = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { name, words, subreddits } = item as { name?: unknown; words?: unknown; subreddits?: unknown }
    if (typeof name !== 'string' || name.trim() === '') continue
    const named = name.trim()
    profile.push({ name: named, words: strings(words), subreddits: subreddits === undefined ? [...(defaults.get(named) ?? [])] : strings(subreddits) })
  }
  return profile
}
