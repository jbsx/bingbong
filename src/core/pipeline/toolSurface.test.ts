import { describe, expect, it } from 'vitest'
import type { Tool } from './tool'
import { createBrowserTools } from './browserTools'
import { createMediaTools } from './mediaTools'
import { createSearchTools } from './searchTools'
import { FakeBrowser, FakeSearch } from '../testing/doubles'

// The full orchestrator tool catalog, assembled exactly as
// createAssistantPipeline assembles it (main/agent/createAssistantPipeline.ts).
// This file pins the surface: no ad-skip capability may ever appear in it —
// not as a tool, not as a parameter enum value, not hidden in a description.
// (The system prompt's "never skip ads" rule is policy, not surface; tool
// descriptions deliberately never mention ads so this scan can stay strict.)

function orchestratorToolCatalog(): Tool[] {
  return [
    ...createBrowserTools(new FakeBrowser()),
    ...createMediaTools(new FakeBrowser()),
    ...createSearchTools(new FakeSearch()),
  ]
}

// Matches any phrasing that pairs skipping/closing/bypassing with ads.
const AD_SKIP_RE = /\b(skip|close|bypass|fast[- ]forward)\b[^.\n]*\bads?\b|\bads?\b[^.\n]*\b(skip|close|bypass|fast[- ]forward)\b/i

describe('orchestrator tool surface', () => {
  it('is exactly the intended catalog — nothing more', () => {
    const names = orchestratorToolCatalog().map((tool) => tool.name)

    expect(names.sort()).toEqual(
      [
        'navigate',
        'read_page',
        'click',
        'type',
        'scroll',
        'screenshot',
        'back',
        'media_control',
        'web_search',
      ].sort(),
    )
  })

  it('has no tool whose name or description mentions skipping ads', () => {
    for (const tool of orchestratorToolCatalog()) {
      expect(`${tool.name} ${tool.description ?? ''}`).not.toMatch(AD_SKIP_RE)
    }
  })

  it('has no parameter enum value for skipping ads', () => {
    for (const tool of orchestratorToolCatalog()) {
      for (const spec of Object.values(tool.parameters ?? {})) {
        for (const value of spec.enum ?? []) {
          expect(value).not.toMatch(AD_SKIP_RE)
          expect(value).not.toMatch(/\bads?\b/i)
        }
      }
    }
  })

  it('media verbs are playback-only', () => {
    const media = createMediaTools(new FakeBrowser()).find((tool) => tool.name === 'media_control')
    expect(media?.parameters?.['action']?.enum).toEqual(['play_pause', 'volume_up', 'volume_down', 'next', 'seek'])
  })
})
