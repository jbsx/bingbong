import { describe, expect, it } from 'vitest'
import { createPanelTools } from './panelTools'
import { FakeClock, FakePanel } from '../testing/doubles'
import { LOCAL_CONTROL_PHRASES } from '../voice/voiceSession'
import type { ToolCall } from '../ports/llm'

// Panel voice tools (#64, ADR 0006): toggle_panel and set_panel_mode are
// model-invoked tools on the panel-state seam — the same toggle/setMode the
// dashboard buttons and the keyboard shortcut drive. Panel ops are silent
// (the panel's own motion is the feedback, no TTS ack) and unconfirmed
// (layout is reversible, so they never pause for a risk gate), and there is
// deliberately no phrase routing: paraphrases are the model's job, the same
// decision as new_session (ADR 0002).

function callOf(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, args }
}

describe('createPanelTools', () => {
  it('is exactly toggle_panel and set_panel_mode', () => {
    const names = createPanelTools(new FakePanel()).map((tool) => tool.name)
    expect(names.sort()).toEqual(['set_panel_mode', 'toggle_panel'])
  })

  it('toggle_panel opens a collapsed panel through the state seam', async () => {
    const panel = new FakePanel()
    const tool = createPanelTools(panel).find((t) => t.name === 'toggle_panel')!

    const result = await tool.execute(callOf('toggle_panel'), { clock: new FakeClock() })

    expect(panel.toggles).toHaveLength(1)
    expect(panel.state()).toMatchObject({ mode: 'overlay', open: true })
    expect(result).toEqual('Panel opened.')
  })

  it('toggle_panel collapses an open panel', async () => {
    const panel = new FakePanel({ mode: 'overlay', open: true, width: 880 })
    const tool = createPanelTools(panel).find((t) => t.name === 'toggle_panel')!

    const result = await tool.execute(callOf('toggle_panel'), { clock: new FakeClock() })

    expect(panel.state().open).toBe(false)
    expect(result).toEqual('Panel collapsed.')
  })

  it('set_panel_mode switches overlay→docked through the same seam the dock button drives', async () => {
    const panel = new FakePanel()
    const tool = createPanelTools(panel).find((t) => t.name === 'set_panel_mode')!

    const result = await tool.execute(callOf('set_panel_mode', { mode: 'docked' }), { clock: new FakeClock() })

    expect(panel.modes).toEqual(['docked'])
    expect(panel.state().mode).toBe('docked')
    expect(result).toEqual('Panel mode set to docked.')
  })

  it('set_panel_mode switches back docked→overlay', async () => {
    const panel = new FakePanel({ mode: 'docked', open: true, width: 880 })
    const tool = createPanelTools(panel).find((t) => t.name === 'set_panel_mode')!

    const result = await tool.execute(callOf('set_panel_mode', { mode: 'overlay' }), { clock: new FakeClock() })

    expect(panel.modes).toEqual(['overlay'])
    expect(panel.state()).toMatchObject({ mode: 'overlay', open: true })
    expect(result).toEqual('Panel mode set to overlay.')
  })

  it('set_panel_mode rejects any mode outside overlay/docked', async () => {
    const panel = new FakePanel()
    const tool = createPanelTools(panel).find((t) => t.name === 'set_panel_mode')!

    await expect(tool.execute(callOf('set_panel_mode', { mode: 'fullscreen' }), { clock: new FakeClock() })).rejects.toThrow(
      /mode.*overlay.*docked/,
    )
    expect(panel.modes).toEqual([])
  })

  it('panel ops fire immediately: no risk gate, no ask, no history gating', () => {
    for (const tool of createPanelTools(new FakePanel())) {
      expect(tool.assessRisk).toBeUndefined()
      expect(tool.askUser).toBeUndefined()
      expect(tool.requiresHistory).not.toBe(true)
    }
  })

  it('carries no phrase routing: no parameters on toggle, mode-only on set_panel_mode', () => {
    const [setMode, toggle] = createPanelTools(new FakePanel()).sort((a, b) => a.name.localeCompare(b.name))
    expect(setMode!.name).toBe('set_panel_mode')
    expect(toggle!.name).toBe('toggle_panel')

    expect(toggle!.parameters).toBeUndefined()
    expect(Object.keys(setMode!.parameters ?? {})).toEqual(['mode'])
    expect(setMode!.parameters?.['mode']?.enum).toEqual(['overlay', 'docked'])
  })

  it('no panel phrase is locally routed — "open the panel" rides to the model, not a router', () => {
    // ADR 0006: phrase routing was considered and rejected for UI control;
    // the only locally-routed phrases are run control. Pin that no panel
    // vocabulary ever joins the local router — paraphrases are the model's
    // job, dispatched through these tools.
    const routed = Object.values(LOCAL_CONTROL_PHRASES)
      .flat()
      .map((phrase) => phrase.toLowerCase())
    for (const panelWord of ['panel', 'dock', 'overlay', 'feed', 'undock', 'float']) {
      expect(routed).not.toContain(panelWord)
    }
  })
})
