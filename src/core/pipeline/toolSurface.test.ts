import { describe, expect, it } from 'vitest'
import type { Tool } from './tool'
import { createAskUserTool } from './askUserTools'
import { createBrowserTools } from './browserTools'
import { createVisionGroundingTools } from './visionGroundingTools'
import { createMediaTools } from './mediaTools'
import { createSearchTools } from './searchTools'
import { createSubagentTools } from './subagentTools'
import { createPanelTools } from './panelTools'
import { FakeBrowser, FakePanel, FakeSearch, FakeVision } from '../testing/doubles'

const unusedVision = new FakeVision()

// The full orchestrator tool catalog, assembled exactly as
// createAssistantPipeline assembles it (main/agent/createAssistantPipeline.ts).
// This file pins the surface: no ad-skip capability may ever appear in it —
// not as a tool, not as a parameter enum value, not hidden in a description.
// (The system prompt's "never skip ads" rule is policy, not surface; tool
// descriptions deliberately never mention ads so this scan can stay strict.)

function orchestratorToolCatalog(): Tool[] {
  return [
    createAskUserTool(),
    ...createBrowserTools(new FakeBrowser(), unusedVision),
    ...createVisionGroundingTools(new FakeBrowser(), unusedVision),
    ...createMediaTools(new FakeBrowser()),
    ...createSearchTools(new FakeSearch()),
  ]
}

// The panel tools (toggle_panel/set_panel_mode) are added on top by
// createAssistantPipeline when a feed panel is attached — in production it
// always is (one per window). Same scan rules apply.
function panelToolCatalog(): Tool[] {
  return createPanelTools(new FakePanel())
}

// The delegation tools (spawn/cancel/agent_results) are added on top by
// createAssistantPipeline when the subagent runtime is attached — same rule:
// they must never mention ads either.
function delegationToolCatalog(): Tool[] {
  const manager = {
    spawn: () => ({ ok: false as const, reason: 'test' }),
    cancel: () => ({ ok: false as const, reason: 'test' }),
    cancelAll: () => 0,
    pauseAll: () => {},
    resumeAll: () => {},
    results: async () => 'none',
    list: () => [],
    isRunning: () => false,
  }
  return createSubagentTools(manager)
}

// Matches any phrasing that pairs skipping/closing/bypassing with ads.
const AD_SKIP_RE = /\b(skip|close|bypass|fast[- ]forward)\b[^.\n]*\bads?\b|\bads?\b[^.\n]*\b(skip|close|bypass|fast[- ]forward)\b/i

describe('orchestrator tool surface', () => {
  it('is exactly the intended catalog — nothing more', () => {
    const names = orchestratorToolCatalog().map((tool) => tool.name)

    expect(names.sort()).toEqual(
      [
        'ask_user',
        'navigate',
        'read_page',
        'click',
        'type',
        'scroll',
        'screenshot',
        'back',
        'go_forward',
        'ground_visual',
        'look',
        'media_control',
        'web_search',
      ].sort(),
    )
  })

  it('go_forward is registered at parity with back', () => {
    const byName = Object.fromEntries(orchestratorToolCatalog().map((tool) => [tool.name, tool]))
    const back = byName.back
    const goForward = byName.go_forward

    expect(back).toBeDefined()
    expect(goForward).toBeDefined()
    // Same grammar as back: parameter-free, ungated, history-independent.
    for (const tool of [back, goForward]) {
      expect(tool.parameters ?? {}).toEqual({})
      expect(tool.assessRisk).toBeUndefined()
      expect(tool.requiresHistory).not.toBe(true)
    }
    expect(goForward.description).toMatch(/forward/i)
    expect(goForward.description).toMatch(/history/i)
  })

  it('delegation adds exactly spawn_agent, cancel_agent and agent_results', () => {
    const names = delegationToolCatalog().map((tool) => tool.name)
    expect(names.sort()).toEqual(['agent_results', 'cancel_agent', 'spawn_agent'])
  })

  it('panel adds exactly toggle_panel and set_panel_mode, ungated on history', () => {
    const panel = panelToolCatalog()
    const names = panel.map((tool) => tool.name)
    expect(names.sort()).toEqual(['set_panel_mode', 'toggle_panel'])
    for (const tool of panel) {
      expect(tool.requiresHistory).not.toBe(true)
    }
  })

  it('has no tool whose name or description mentions skipping ads', () => {
    for (const tool of [...orchestratorToolCatalog(), ...delegationToolCatalog(), ...panelToolCatalog()]) {
      expect(`${tool.name} ${tool.description ?? ''}`).not.toMatch(AD_SKIP_RE)
    }
  })

  it('has no parameter enum value for skipping ads', () => {
    for (const tool of [...orchestratorToolCatalog(), ...delegationToolCatalog(), ...panelToolCatalog()]) {
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
