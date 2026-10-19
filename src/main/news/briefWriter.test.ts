import { describe, expect, it } from 'vitest'
import type { BriefStory } from '../../core/news/storyBrief'
import { createBriefWriter } from './briefWriter'

const ENDPOINT = { baseUrl: 'https://api.example.com/v4', model: 'GLM-5.3', apiKey: 'k' }

const STORY: BriefStory = {
  key: 'GitHub trending:acme/tui',
  title: 'acme/tui: a terminal UI',
  source: 'GitHub trending',
  link: 'https://github.com/acme/tui',
  about: null,
  magnitude: 10,
  unit: 'stars today',
  topics: [],
  words: [],
  sources: ['GitHub trending'],
}

function answering(status: number, body: unknown): typeof fetch & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  const stub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return Object.assign(stub, { calls })
}

describe('createBriefWriter', () => {
  it('asks the chat endpoint once, thinking off, and reads the reply as briefs', async () => {
    const fetchImpl = answering(200, { choices: [{ message: { content: '{"1": {"what": "A terminal UI.", "why": "10 stars today."}}' } }] })
    const briefs = await createBriefWriter(ENDPOINT, fetchImpl).write([STORY])
    expect(briefs).toEqual({ [STORY.key]: { what: 'A terminal UI.', why: '10 stars today.' } })
    expect(fetchImpl.calls).toHaveLength(1)
    expect(fetchImpl.calls[0].url).toBe('https://api.example.com/v4/chat/completions')
    expect(new Headers(fetchImpl.calls[0].init.headers).get('authorization')).toBe('Bearer k')
    const sent = JSON.parse(String(fetchImpl.calls[0].init.body)) as { model: string; thinking: unknown; messages: { role: string; content: string }[] }
    expect(sent.model).toBe('GLM-5.3')
    expect(sent.thinking).toEqual({ type: 'disabled' })
    expect(sent.messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(sent.messages[1].content).toContain('Title: acme/tui: a terminal UI')
  })

  it('throws on an error status or a reply with no message', async () => {
    await expect(createBriefWriter(ENDPOINT, answering(429, {})).write([STORY])).rejects.toThrow(/429/)
    await expect(createBriefWriter(ENDPOINT, answering(200, { choices: [] })).write([STORY])).rejects.toThrow(/no message/)
  })
})
