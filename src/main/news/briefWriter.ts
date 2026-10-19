import type { ModelEndpointConfig } from '../../core/decision/decisionRouting'
import { BRIEF_INSTRUCTIONS, briefAsk, readBriefs, type StoryBriefWriter } from '../../core/news/storyBrief'

/** A handful of stories' briefs come back in a few seconds; past this the poll gives up and asks again next hour. */
const WRITE_TIMEOUT_MS = 45_000

/**
 * The Story Brief writer over an OpenAI-compatible chat endpoint (GLM on
 * Z.ai by default, briefWriterRouting): one request for every story that
 * needs a brief, thinking off — it is a short rewrite, not a problem — and
 * the reply read as JSON. Any failure throws; the News Desk reports it and
 * keeps the headlines.
 */
export function createBriefWriter(endpoint: ModelEndpointConfig, fetchImpl: typeof fetch = fetch): StoryBriefWriter {
  return {
    async write(stories) {
      const response = await fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${endpoint.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: endpoint.model,
          thinking: { type: 'disabled' },
          temperature: 0.3,
          messages: [
            { role: 'system', content: BRIEF_INSTRUCTIONS },
            { role: 'user', content: briefAsk(stories) },
          ],
        }),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`the brief writer answered ${response.status}`)
      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
      const content = body.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('the brief writer answered no message')
      return readBriefs(content, stories)
    },
  }
}
