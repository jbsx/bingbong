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
    expect(refStatesOf(captionsButton, button)).toEqual(['pressed=true', 'keyshortcuts="c"'])
  })

  it('names a description that adds to the label, never one the label already holds', () => {
    const save: AxNode = { role: { type: 'role', value: 'button' }, description: { type: 'computedString', value: 'Save to Watch later' } }
    expect(refStatesOf(save, { kind: 'button', label: 'Save', inputType: null })).toEqual(['description="Save to Watch later"'])
    const echoed: AxNode = { role: { type: 'role', value: 'button' }, description: { type: 'computedString', value: 'Settings' } }
    expect(refStatesOf(echoed, { kind: 'button', label: 'Settings Settings', inputType: null })).toEqual([])
  })

  it('names a role the kind does not already say', () => {
    const loopItem: AxNode = {
      role: { type: 'role', value: 'menuitemcheckbox' },
      properties: [{ name: 'checked', value: { type: 'tristate', value: 'false' } }],
    }
    expect(refStatesOf(loopItem, { kind: 'button', label: 'Loop', inputType: null })).toEqual(['role=menuitemcheckbox', 'checked=false'])
    const checkbox: AxNode = { role: { type: 'role', value: 'checkbox' }, properties: [{ name: 'checked', value: { type: 'tristate', value: 'true' } }] }
    expect(refStatesOf(checkbox, { kind: 'input', label: 'Remember me', inputType: 'checkbox' })).toEqual(['checked=true'])
    const field: AxNode = { role: { type: 'role', value: 'textbox' } }
    expect(refStatesOf(field, { kind: 'input', label: 'Email', inputType: 'email' })).toEqual([])
  })
})
