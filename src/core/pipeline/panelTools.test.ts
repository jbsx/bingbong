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
  it('is exactly toggle_panel, set_panel_mode and set_panel_width', () => {
    const names = createPanelTools(new FakePanel()).map((tool) => tool.name)
    expect(names.sort()).toEqual(['set_panel_mode', 'set_panel_width', 'toggle_panel'])
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
    const [setMode, , toggle] = createPanelTools(new FakePanel()).sort((a, b) => a.name.localeCompare(b.name))
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

describe('set_panel_width (#71)', () => {
  function widthTool(panel: FakePanel) {
    const tool = createPanelTools(panel).find((t) => t.name === 'set_panel_width')
    if (!tool) throw new Error('set_panel_width missing from the panel catalog')
    return tool
  }

  it('exposes no absolute-pixel interface — no width/pixel parameter, and a width arg is refused', async () => {
    const panel = new FakePanel()
    const tool = widthTool(panel)

    // Structural: every parameter is an enum or a bounded step count —
    // none names a pixel quantity.
    for (const [name, spec] of Object.entries(tool.parameters ?? {})) {
      expect(name).not.toMatch(/width|pixel|px/i)
      expect(spec.description).not.toMatch(/\b\d{3,}\s*pixels?\b/i)
    }

    // Behavioral: pixels have no way in — the call rejects without driving
    // the seam.
    await expect(tool.execute(callOf('set_panel_width', { width: 500 }), { clock: new FakeClock() })).rejects.toThrow(
      /exactly one/i,
    )
    expect(panel.widths).toEqual([])
  })

  it('steps wider through the same setWidth seam the drag drives, clamped to the ceiling', async () => {
    const panel = new FakePanel({ mode: 'overlay', open: true, width: 880 }, 1280)
    const tool = widthTool(panel)

    // 880 + 2×160 = 1200, clamped to 75% of 1280.
    const result = await tool.execute(callOf('set_panel_width', { direction: 'wider', steps: 2 }), {
      clock: new FakeClock(),
    })

    expect(panel.widths).toEqual([960])
    expect(panel.state().width).toBe(960)
    expect(result).toBe('Panel width set to 960px.')
  })

  it('steps narrower, one step when the count is omitted, clamped to the floor', async () => {
    const panel = new FakePanel({ mode: 'overlay', open: true, width: 880 }, 1280)
    const tool = widthTool(panel)

    expect(await tool.execute(callOf('set_panel_width', { direction: 'narrower' }), { clock: new FakeClock() })).toBe(
      'Panel width set to 720px.',
    )
    expect(panel.widths).toEqual([720])

    // 360 − 160 = 200 → the 320px floor holds.
    const nearFloor = new FakePanel({ mode: 'overlay', open: true, width: 360 }, 1280)
    await widthTool(nearFloor).execute(callOf('set_panel_width', { direction: 'narrower' }), { clock: new FakeClock() })
    expect(nearFloor.state().width).toBe(320)
  })

  it('coerces a numeric-string step count like media seek, rejects junk counts', async () => {
    const panel = new FakePanel({ mode: 'overlay', open: true, width: 880 }, 1280)
    const tool = widthTool(panel)

    await tool.execute(callOf('set_panel_width', { direction: 'narrower', steps: '2' }), { clock: new FakeClock() })
    expect(panel.widths).toEqual([560])

    for (const junk of [0, -1, 6, 2.5, 'two']) {
      await expect(
        tool.execute(callOf('set_panel_width', { direction: 'narrower', steps: junk }), { clock: new FakeClock() }),
      ).rejects.toThrow(/steps.*1-5/)
    }
  })

  it('applies the half_screen preset at half the window width', async () => {
    const panel = new FakePanel({ mode: 'overlay', open: true, width: 880 }, 1280)
    const tool = widthTool(panel)

    const result = await tool.execute(callOf('set_panel_width', { preset: 'half_screen' }), { clock: new FakeClock() })

    expect(panel.widths).toEqual([640])
    expect(result).toBe('Panel width set to 640px.')
  })

  it('the preset honors the floor on a window too small for half of it', async () => {
    const panel = new FakePanel({ mode: 'overlay', open: true, width: 880 }, 400)
    const tool = widthTool(panel)

    await tool.execute(callOf('set_panel_width', { preset: 'half_screen' }), { clock: new FakeClock() })
    expect(panel.state().width).toBe(320)
  })

  it('rejects direction and preset together, and neither', async () => {
    const panel = new FakePanel()
    const tool = widthTool(panel)

    await expect(
      tool.execute(callOf('set_panel_width', { direction: 'wider', preset: 'half_screen' }), { clock: new FakeClock() }),
    ).rejects.toThrow(/exactly one/i)
    await expect(tool.execute(callOf('set_panel_width', {}), { clock: new FakeClock() })).rejects.toThrow(/exactly one/i)
    expect(panel.widths).toEqual([])
  })

  it('rejects steps without a direction, and vocabulary outside the enums', async () => {
    const panel = new FakePanel()
    const tool = widthTool(panel)

    await expect(
      tool.execute(callOf('set_panel_width', { preset: 'half_screen', steps: 2 }), { clock: new FakeClock() }),
    ).rejects.toThrow(/steps.*direction/)
    await expect(
      tool.execute(callOf('set_panel_width', { direction: 'widest' }), { clock: new FakeClock() }),
    ).rejects.toThrow(/direction.*wider.*narrower/)
    await expect(
      tool.execute(callOf('set_panel_width', { preset: 'full_screen' }), { clock: new FakeClock() }),
    ).rejects.toThrow(/preset.*half_screen/)
    expect(panel.widths).toEqual([])
  })
})
