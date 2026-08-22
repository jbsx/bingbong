import { describe, expect, it } from 'vitest'
import type { Tool } from './tool'
import { createAskUserTool } from './askUserTools'
import { createBrowserTools } from './browserTools'
import { createVisionGroundingTools } from './visionGroundingTools'
import { createMediaTools } from './mediaTools'
import { createSearchTools } from './searchTools'
import { createSubagentTools } from './subagentTools'
import { createPanelTools } from './panelTools'
import { createAppControlTool, createSetSettingTool } from './settingsTools'
import { FakeAppControls, FakeBrowser, FakePanel, FakeSearch, FakeSettings, FakeVision } from '../testing/doubles'

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

// The settings tools (#67) are added on top by createAssistantPipeline when
// the settings store and app controls are attached — in production they
// always are. Same scan rules apply.
function settingsToolCatalog(): Tool[] {
  return [createSetSettingTool(new FakeSettings()), createAppControlTool(new FakeAppControls())]
}

/** Every catalog the ad-skip scans cover — the whole orchestrator surface. */
function allCatalogs(): Tool[] {
  return [...orchestratorToolCatalog(), ...delegationToolCatalog(), ...panelToolCatalog(), ...settingsToolCatalog()]
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

  it('settings adds exactly set_setting, firing immediately and ungated', () => {
    const [setSetting, appControl] = settingsToolCatalog()
    expect(setSetting.name).toBe('set_setting')
    expect(appControl.name).toBe('app_control')

    // set_setting: no confirmation, no ask, no history gating — tuning is
    // instantly reversible, so it never pauses for a risk gate.
    expect(setSetting.assessRisk).toBeUndefined()
    expect(setSetting.askUser).toBeUndefined()
    expect(setSetting.requiresHistory).not.toBe(true)
  })

  it('app_control is confirm-gated: quit and reload both pause on the yes/no gate', () => {
    const appControl = settingsToolCatalog()[1]!
    expect(appControl.assessRisk).toBeDefined()
    expect(appControl.assessRisk!({ id: 'c', name: 'app_control', args: { action: 'quit' } })).toEqual({
      kind: 'confirm',
      prompt: 'Quit Bing Bong?',
    })
    expect(appControl.assessRisk!({ id: 'c', name: 'app_control', args: { action: 'reload' } })).toEqual({
      kind: 'confirm',
      prompt: 'Reload the app window?',
    })
    expect(appControl.requiresHistory).not.toBe(true)
  })

  it('credential, API-key and mic settings are not expressible through set_setting', () => {
    // Keyboard-only territory (ADR 0006). "Expressible" is structural: a
    // tool name, parameter name, or enum value that names a credential or
    // mic field. Descriptions are exempt — they state the exclusion as
    // policy ("API keys ... are not voice-reachable"), the same way the
    // prompt's risk-gate section does.
    const CREDENTIAL_RE = /api[ _-]?key|credential|secret|password|mic(rophone)?/i
    for (const tool of settingsToolCatalog()) {
      expect(tool.name).not.toMatch(CREDENTIAL_RE)
      for (const [paramName, spec] of Object.entries(tool.parameters ?? {})) {
        expect(paramName).not.toMatch(CREDENTIAL_RE)
        for (const value of spec.enum ?? []) {
          expect(value).not.toMatch(CREDENTIAL_RE)
        }
      }
    }

    // The hard guarantee behind the scan: no setting enum value names a
    // credential or mic field, and calling one rejects without a store write.
    const setSetting = settingsToolCatalog()[0]!
    const enumValues = setSetting.parameters?.['setting']?.enum ?? []
    expect(enumValues).not.toContain('api_keys')
    expect(enumValues).not.toContain('mic_id')
    const settings = new FakeSettings()
    void setSetting.execute?.({ id: 'c', name: 'set_setting', args: { setting: 'mic_id', string_value: 'x' } }, {
      clock: { now: () => 0, setTimer: () => () => {} },
    }).catch(() => {})
    expect(settings.updates).toEqual([])
  })

  it('has no tool whose name or description mentions skipping ads', () => {
    for (const tool of allCatalogs()) {
      expect(`${tool.name} ${tool.description ?? ''}`).not.toMatch(AD_SKIP_RE)
    }
  })

  it('has no parameter enum value for skipping ads', () => {
    for (const tool of allCatalogs()) {
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
