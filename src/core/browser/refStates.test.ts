import { describe, expect, it } from 'vitest'
import { refStatesOf, type AxNode } from './refStates'

// YouTube's captions button as Chrome's accessibility tree answered for it on
// 2026-10-20: a stale "unavailable" name over a switch that is on.
const captionsButton: AxNode = {
  ignored: false,
  role: { type: 'role', value: 'button' },
  name: { type: 'computedString', value: 'Subtitles/closed captions unavailable' },
  properties: [
    { name: 'invalid', value: { type: 'token', value: 'false' } },
    { name: 'focusable', value: { type: 'booleanOrUndefined', value: true } },
    { name: 'pressed', value: { type: 'tristate', value: 'true' } },
    { name: 'keyshortcuts', value: { type: 'string', value: 'c' } },
  ],
}
const button = { kind: 'button', label: 'Subtitles/closed captions unavailable', inputType: null } as const

describe('refStatesOf', () => {
  it("names a switch's setting and its shortcut, not what every control has", () => {
    expect(refStatesOf(captionsButton, button).states).toEqual(['pressed=true', 'keyshortcuts="c"'])
  })

  it('names a description that adds to the label, never one the label already holds', () => {
    const save: AxNode = { role: { type: 'role', value: 'button' }, description: { type: 'computedString', value: 'Save to Watch later' } }
    expect(refStatesOf(save, { kind: 'button', label: 'Save', inputType: null }).states).toEqual(['description="Save to Watch later"'])
    const echoed: AxNode = { role: { type: 'role', value: 'button' }, description: { type: 'computedString', value: 'Settings' } }
    expect(refStatesOf(echoed, { kind: 'button', label: 'Settings Settings', inputType: null }).states).toEqual([])
  })

  it("names the control's current value, unless its label already holds it", () => {
    const volume: AxNode = { role: { type: 'role', value: 'slider' }, value: { type: 'number', value: 40 }, properties: [{ name: 'valuemax', value: { type: 'number', value: 100 } }] }
    expect(refStatesOf(volume, { kind: 'button', label: 'Volume', inputType: null }).states).toEqual(['role=slider', 'value=40', 'valuemax=100'])
    const typed: AxNode = { role: { type: 'role', value: 'textbox' }, value: { type: 'string', value: 'weather in London' } }
    expect(refStatesOf(typed, { kind: 'input', label: 'Search', inputType: 'text' }).states).toEqual(['value="weather in London"'])
    expect(refStatesOf({ ...typed, value: { type: 'string', value: 'Search' } }, { kind: 'input', label: 'Search', inputType: 'text' }).states).toEqual([])
  })

  it('names an element as editable where its kind does not say so: a text field already does', () => {
    const editable = [{ name: 'editable', value: { type: 'token', value: 'richtext' } }]
    expect(refStatesOf({ properties: editable }, { kind: 'button', label: 'Post text', inputType: null }).states).toEqual(['editable=richtext'])
    expect(refStatesOf({ properties: editable }, { kind: 'input', label: 'Email', inputType: 'email' }).states).toEqual([])
  })

  // An icon button whose markup holds no text (#382, ADR 0084): Chrome computes its name from an svg <title> or an img alt.
  it("gives a ref with no label of its own the browser's accessible name, and states read against it", () => {
    const icon: AxNode = {
      role: { type: 'role', value: 'button' },
      name: { type: 'computedString', value: '  Search\n' },
      description: { type: 'computedString', value: 'Search' },
    }
    expect(refStatesOf(icon, { kind: 'button', label: '', inputType: null })).toEqual({ label: 'Search', states: [] })
    expect(refStatesOf({ ...icon, name: { type: 'computedString', value: 'x'.repeat(200) } }, { kind: 'button', label: '', inputType: null }).label).toHaveLength(80)
  })

  it('leaves a label the page gave as it is, and a ref the tree names nothing as textless', () => {
    const named: AxNode = { role: { type: 'role', value: 'button' }, name: { type: 'computedString', value: 'Settings' } }
    expect(refStatesOf(named, { kind: 'button', label: 'Gear', inputType: null })).toEqual({ states: [] })
    expect(refStatesOf({ role: named.role, name: { type: 'computedString', value: ' ' } }, { kind: 'button', label: '', inputType: null })).toEqual({ states: [] })
    expect(refStatesOf({ ...named, ignored: true }, { kind: 'button', label: '', inputType: null })).toEqual({ states: [] })
  })

  it('names a role the kind does not already say', () => {
    const loopItem: AxNode = {
      role: { type: 'role', value: 'menuitemcheckbox' },
      properties: [{ name: 'checked', value: { type: 'tristate', value: 'false' } }],
    }
    expect(refStatesOf(loopItem, { kind: 'button', label: 'Loop', inputType: null }).states).toEqual(['role=menuitemcheckbox', 'checked=false'])
    const checkbox: AxNode = { role: { type: 'role', value: 'checkbox' }, properties: [{ name: 'checked', value: { type: 'tristate', value: 'true' } }] }
    expect(refStatesOf(checkbox, { kind: 'input', label: 'Remember me', inputType: 'checkbox' }).states).toEqual(['checked=true'])
    const field: AxNode = { role: { type: 'role', value: 'textbox' } }
    expect(refStatesOf(field, { kind: 'input', label: 'Email', inputType: 'email' }).states).toEqual([])
  })
})
