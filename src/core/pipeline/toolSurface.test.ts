import { describe, expect, it } from 'vitest'
import type { Tool } from './tool'
import { createAskUserTool } from './askUserTools'
import { createBrowserTools } from './browserTools'
import { BROWSER_TOOLS } from './blockerGate'
import { createVisionGroundingTools } from './visionGroundingTools'
import { createMediaTools } from './mediaTools'
import { createSubagentTools } from './subagentTools'
import { createPanelTools } from './panelTools'
import { createAppControlTool, createSetSettingTool } from './settingsTools'
import { createReportHeadlineTool } from './headlineTools'
import { FakeAppControls, FakeBrowser, FakePanel, FakeSettings, FakeVision } from '../testing/doubles'

const unusedVision = new FakeVision()

// The full orchestrator tool catalog, assembled exactly as
// createAssistantPipeline assembles it (main/agent/createAssistantPipeline.ts).
// This file pins the surface: no ad-skip capability may ever appear in it —
// not as a tool, not as a parameter enum value, not hidden in a description.
// (The system prompt's "never skip ads" rule is policy, not surface; tool
// descriptions deliberately never mention ads so this scan can stay strict.)
// Since #83 / ADR 0009 the same strictness covers the deleted off-screen web
// tools: every read and write happens in a visible tab.

function orchestratorToolCatalog(): Tool[] {
  return [
    createAskUserTool(),
    ...createBrowserTools(new FakeBrowser(), unusedVision),
    ...createVisionGroundingTools(new FakeBrowser(), unusedVision),
    ...createMediaTools(new FakeBrowser()),
    createReportHeadlineTool(),
  ]
}

// The panel tools (toggle_panel/set_panel_mode/set_panel_width) are added on
// top by createAssistantPipeline when a feed panel is attached — in
// production it always is (one per window). Same scan rules apply.
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
    retire: () => 0,
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
        'report_headline',
      ].sort(),
    )
  })

  it('report_headline is the Run Headline surface (ADR 0025): one string in, ungated, no history needed', async () => {
    const headline = orchestratorToolCatalog().find((tool) => tool.name === 'report_headline')!
    expect(Object.keys(headline.parameters ?? {}).sort()).toEqual(['headline'])
    expect(headline.parameters?.['headline']?.type).toBe('string')
    // Reporting a title is pure narration — never a risk gate, never
    // continuity-bound.
    expect(headline.assessRisk).toBeUndefined()
    expect(headline.requiresHistory).not.toBe(true)
    await expect(
      headline.execute?.({ id: 'c', name: 'report_headline', args: { headline: 'Find a blue mug' } }, { clock: { now: () => 0, setTimer: () => () => {} } }),
    ).resolves.toBe('Headline noted.')
  })

  it('has no off-screen web tool anywhere on the surface (#83, ADR 0009)', () => {
    // web_search and read_url are deleted: every web read and write happens
    // in a rendered, visible tab. The names must never reappear in any
    // catalog — not as a tool, not as a parameter enum value.
    for (const catalog of [orchestratorToolCatalog(), delegationToolCatalog(), panelToolCatalog(), settingsToolCatalog()]) {
      for (const tool of catalog) {
        expect(tool.name).not.toMatch(/web_search|read_url/)
        for (const paramName of Object.keys(tool.parameters ?? {})) {
          expect(paramName).not.toMatch(/web_search|read_url/)
        }
        for (const spec of Object.values(tool.parameters ?? {})) {
          for (const value of spec.enum ?? []) expect(value).not.toMatch(/web_search|read_url/)
        }
      }
    }
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

  it('panel adds exactly toggle_panel, set_panel_mode and set_panel_width, ungated on history', () => {
    const panel = panelToolCatalog()
    const names = panel.map((tool) => tool.name)
    expect(names.sort()).toEqual(['set_panel_mode', 'set_panel_width', 'toggle_panel'])
    for (const tool of panel) {
      expect(tool.requiresHistory).not.toBe(true)
    }
  })

  it('set_panel_width speaks relative grammar only — no absolute-pixel surface', async () => {
    // Spec #71 / ADR 0006: voice width is steps and presets, never pixels.
    // Structural: the width tool's parameter surface is exactly the two
    // enums plus a bounded step count — no parameter names or offers a
    // pixel quantity.
    const width = panelToolCatalog().find((tool) => tool.name === 'set_panel_width')!
    expect(Object.keys(width.parameters ?? {}).sort()).toEqual(['direction', 'preset', 'steps'])
    expect(width.parameters?.['direction']?.enum).toEqual(['wider', 'narrower'])
    expect(width.parameters?.['preset']?.enum).toEqual(['half_screen'])
    expect(width.parameters?.['steps']?.enum).toBeUndefined()

    // Behavioral: a pixel arg has no way in — the call rejects.
    await expect(
      width.execute?.({ id: 'c', name: 'set_panel_width', args: { width: 500 } }, { clock: { now: () => 0, setTimer: () => () => {} } }),
    ).rejects.toThrow(/exactly one/i)
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

  it('the Blocker gate knows every browser verb — a new one cannot slip past it (#80)', () => {
    // The same-wall gate refuses all browser verbs on an armed host except
    // its exemptions; its verb set is hand-enumerated, so this pins it to
    // the real catalog — drift here would silently exempt a new verb.
    const browserToolNames = createBrowserTools(new FakeBrowser(), unusedVision).map((tool) => tool.name)
    expect([...BROWSER_TOOLS].sort()).toEqual(browserToolNames.sort())
  })
})
