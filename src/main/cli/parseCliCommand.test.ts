import { describe, expect, it } from 'vitest'
import { parseCliCommand } from './parseCliCommand'

describe('parseCliCommand', () => {
  it('parses navigate with its url input', () => {
    expect(parseCliCommand('navigate https://youtube.com')).toEqual({
      ok: true,
      command: { type: 'navigate', input: 'https://youtube.com' },
    })
    expect(parseCliCommand('navigate  youtube.com ')).toEqual({
      ok: true,
      command: { type: 'navigate', input: 'youtube.com' },
    })
  })

  it('accepts read and read_page as aliases', () => {
    expect(parseCliCommand('read')).toEqual({ ok: true, command: { type: 'read' } })
    expect(parseCliCommand('read_page')).toEqual({ ok: true, command: { type: 'read' } })
  })

  it('parses click with an integer ref', () => {
    expect(parseCliCommand('click 7')).toEqual({ ok: true, command: { type: 'click', ref: 7 } })
  })

  it('rejects click without a valid ref', () => {
    expect(parseCliCommand('click')).toEqual({ ok: false, error: "click: expected a ref number, e.g. 'click 7'" })
    expect(parseCliCommand('click seven')).toEqual({ ok: false, error: "click: expected a ref number, e.g. 'click 7'" })
  })

  it('parses type with ref and free text', () => {
    expect(parseCliCommand('type 3 mechanical keyboards')).toEqual({
      ok: true,
      command: { type: 'type', ref: 3, text: 'mechanical keyboards' },
    })
  })

  it('unescapes \\n in typed text so Enter can be sent', () => {
    expect(parseCliCommand('type 3 mechanical keyboards\\n')).toEqual({
      ok: true,
      command: { type: 'type', ref: 3, text: 'mechanical keyboards\n' },
    })
  })

  it('rejects type without ref or text', () => {
    expect(parseCliCommand('type')).toEqual({ ok: false, error: "type: expected 'type <ref> <text>'" })
    expect(parseCliCommand('type 3')).toEqual({ ok: false, error: "type: expected 'type <ref> <text>'" })
    expect(parseCliCommand('type x hello')).toEqual({ ok: false, error: "type: expected 'type <ref> <text>'" })
  })

  it('parses scroll up/down and rejects other directions', () => {
    expect(parseCliCommand('scroll down')).toEqual({ ok: true, command: { type: 'scroll', direction: 'down' } })
    expect(parseCliCommand('scroll up')).toEqual({ ok: true, command: { type: 'scroll', direction: 'up' } })
    expect(parseCliCommand('scroll sideways')).toEqual({ ok: false, error: "scroll: expected 'scroll up' or 'scroll down'" })
  })

  it('parses screenshot with an optional path', () => {
    expect(parseCliCommand('screenshot')).toEqual({ ok: true, command: { type: 'screenshot', path: undefined } })
    expect(parseCliCommand('screenshot /tmp/shot.jpg')).toEqual({
      ok: true,
      command: { type: 'screenshot', path: '/tmp/shot.jpg' },
    })
  })

  it('parses back, help, and quit/exit', () => {
    expect(parseCliCommand('back')).toEqual({ ok: true, command: { type: 'back' } })
    expect(parseCliCommand('help')).toEqual({ ok: true, command: { type: 'help' } })
    expect(parseCliCommand('quit')).toEqual({ ok: true, command: { type: 'quit' } })
    expect(parseCliCommand('exit')).toEqual({ ok: true, command: { type: 'quit' } })
  })

  it('treats blank lines as no command', () => {
    expect(parseCliCommand('')).toBeNull()
    expect(parseCliCommand('   ')).toBeNull()
  })

  it('reports unknown commands', () => {
    expect(parseCliCommand('frobnicate now')).toEqual({ ok: false, error: "unknown command: 'frobnicate' — try 'help'" })
  })
})
