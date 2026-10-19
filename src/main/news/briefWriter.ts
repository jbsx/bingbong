import type { ModelEndpointConfig } from '../../core/decision/decisionRouting'
import { BRIEF_INSTRUCTIONS, briefAsk, readBriefs, type StoryBriefWriter } from '../../core/news/storyBrief'
import { readSummaries, SUMMARY_INSTRUCTIONS, summaryAsk, type RepoSummaryWriter } from '../../core/news/topRepos'

/** A handful of stories' briefs come back in a few seconds; past this the poll gives up and asks again next hour. */
const WRITE_TIMEOUT_MS = 45_000

/** One chat request, thinking off — it is a short rewrite, not a problem — and the reply's text; any failure throws. */
async function askWriter(endpoint: ModelEndpointConfig, instructions: string, ask: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${endpoint.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: endpoint.model,
      thinking: { type: 'disabled' },
      temperature: 0.3,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: ask },
      ],
    }),
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the brief writer answered ${response.status}`)
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('the brief writer answered no message')
  return content
}

/**
 * The Story Brief writer over an OpenAI-compatible chat endpoint (GLM on
 * Z.ai by default, briefWriterRouting): one request for every story that
 * needs a brief, the reply read as JSON. Any failure throws; the News Desk
 * reports it and keeps the headlines.
 */
export function createBriefWriter(endpoint: ModelEndpointConfig, fetchImpl: typeof fetch = fetch): StoryBriefWriter {
  return {
    async write(stories) {
      return readBriefs(await askWriter(endpoint, BRIEF_INSTRUCTIONS, briefAsk(stories), fetchImpl), stories)
    },
  }
}

/** The Top Repos' summary writer over the same endpoint: one request for every repository with no summary yet. */
export function createRepoSummaryWriter(endpoint: ModelEndpointConfig, fetchImpl: typeof fetch = fetch): RepoSummaryWriter {
  return {
    async write(repos) {
      return readSummaries(await askWriter(endpoint, SUMMARY_INSTRUCTIONS, summaryAsk(repos), fetchImpl), repos)
    },
  }
}
