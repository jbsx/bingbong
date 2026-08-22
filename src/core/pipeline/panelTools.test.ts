import { describe, expect, it } from 'vitest'
import { createPanelTools, type PanelControls } from './panelTools'
import { FakeClock } from '../testing/doubles'
import type { ToolCall } from '../ports/llm'
import type { FeedPanelMode, FeedPanelState } from '../panel/feedPanelState'

// Panel voice tools (#64, ADR 0006): toggle_panel and set_panel_mode are
// model-invoked tools on the panel-state seam — the same toggle/setMode the
// dashboard buttons and the keyboard shortcut drive. Panel ops are silent
// (the panel's own motion is the feedback, no TTS ack) and unconfirmed
// (layout is reversible, so they never pause for a risk gate), and there is
// deliberately no phrase routing: paraphrases are the model's job, the same
// decision as new_session (ADR 0002).

function fakePanel(): PanelControls & { toggles: number; modes: FeedPanelMode[] } {
  let state: FeedPanelState = { mode: 'overlay', open: false }
  return {
    toggles: 0,
    modes: [],
    toggle() {
      this.toggles += 1
      state = { ...state, open: !state.open }
    },
    setMode(mode) {
      this.modes.push(mode)
      state = { ...state, mode }
    },
    state: () => state,
  }
}

function callOf(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, args }
}

describe('createPanelTools', () => {
  it('is exactly toggle_panel and set_panel_mode', () => {
    const names = createPanelTools(fakePanel()).map((tool) => tool.name)
    expect(names.sort()).toEqual(['set_panel_mode', 'toggle_panel'])
  })

  it('toggle_panel opens a collapsed panel through the state seam', async () => {
    const panel = fakePanel()
    const tool = createPanelTools(panel).find((t) => t.name === 'toggle_panel')!

    const result = await tool.execute(callOf('toggle_panel'), { clock: new FakeClock() })

    expect(panel.toggles).toBe(1)
    expect(panel.state()).toEqual({ mode: 'overlay', open: true })
    expect(result).toEqual('Panel opened.')
  })

  it('toggle_panel collapses an open panel', async () => {
    const panel = fakePanel()
    panel.toggle()
    const tool = createPanelTools(panel).find((t) => t.name === 'toggle_panel')!

    const result = await tool.execute(callOf('toggle_panel'), { clock: new FakeClock() })

    expect(panel.state().open).toBe(false)
    expect(result).toEqual('Panel collapsed.')
  })

  it('set_panel_mode switches overlay/docked through the same seam the dock button drives', async () => {
    const panel = fakePanel()
    const tool = createPanelTools(panel).find((t) => t.name === 'set_panel_mode')!

    const result = await tool.execute(callOf('set_panel_mode', { mode: 'docked' }), { clock: new FakeClock() })

    expect(panel.modes).toEqual(['docked'])
    expect(panel.state().mode).toBe('docked')
    expect(result).toEqual('Panel mode set to docked.')
  })

  it('set_panel_mode rejects any mode outside overlay/docked', async () => {
    const panel = fakePanel()
    const tool = createPanelTools(panel).find((t) => t.name === 'set_panel_mode')!

    await expect(tool.execute(callOf('set_panel_mode', { mode: 'fullscreen' }), { clock: new FakeClock() })).rejects.toThrow(
      /mode.*overlay.*docked/,
    )
    expect(panel.modes).toEqual([])
  })

  it('panel ops fire immediately: no risk gate, no ask, no history gating', () => {
    for (const tool of createPanelTools(fakePanel())) {
      expect(tool.assessRisk).toBeUndefined()
      expect(tool.askUser).toBeUndefined()
      expect(tool.requiresHistory).not.toBe(true)
    }
  })

  it('carries no phrase routing: no parameters on toggle, mode-only on set_panel_mode', () => {
    const [setMode, toggle] = createPanelTools(fakePanel()).sort((a, b) => a.name.localeCompare(b.name))
    expect(setMode!.name).toBe('set_panel_mode')
    expect(toggle!.name).toBe('toggle_panel')

    expect(toggle!.parameters).toBeUndefined()
    expect(Object.keys(setMode!.parameters ?? {})).toEqual(['mode'])
    expect(setMode!.parameters?.['mode']?.enum).toEqual(['overlay', 'docked'])
  })
})
