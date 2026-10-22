import { describe, expect, it } from 'vitest'
import { grammarErrorOf, parseCliCommand } from './cliGrammar'

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
    expect(parseCliCommand('scroll sideways')).toEqual({ ok: false, error: "scroll: expected 'scroll up', 'scroll down' or 'scroll <ref> up|down'" })
    // A Scroll Region by its number (#383).
    expect(parseCliCommand('scroll 12 down')).toEqual({ ok: true, command: { type: 'scroll', direction: 'down', ref: 12 } })
    expect(parseCliCommand('scroll 12 sideways')).toMatchObject({ ok: false })
  })

  it('parses screenshot with an optional path', () => {
    expect(parseCliCommand('screenshot')).toEqual({ ok: true, command: { type: 'screenshot', path: undefined } })
    expect(parseCliCommand('screenshot /tmp/shot.jpg')).toEqual({
      ok: true,
      command: { type: 'screenshot', path: '/tmp/shot.jpg' },
    })
  })

  it('parses press with a known key and optional repeat count', () => {
    expect(parseCliCommand('press k')).toEqual({
      ok: true,
      command: { type: 'press', press: { key: 'k' }, times: 1 },
    })
    expect(parseCliCommand('press l 3')).toEqual({
      ok: true,
      command: { type: 'press', press: { key: 'l' }, times: 3 },
    })
    expect(parseCliCommand('press up')).toEqual({
      ok: true,
      command: { type: 'press', press: { key: 'ArrowUp' }, times: 1 },
    })
    expect(parseCliCommand('press next')).toEqual({
      ok: true,
      command: { type: 'press', press: { key: 'n', shift: true }, times: 1 },
    })
  })

  it('presses Tab and Escape, whatever their case', () => {
    expect(parseCliCommand('press Tab 3')).toEqual({ ok: true, command: { type: 'press', press: { key: 'Tab' }, times: 3 } })
    expect(parseCliCommand('press escape')).toEqual({ ok: true, command: { type: 'press', press: { key: 'Escape' }, times: 1 } })
    expect(parseCliCommand('press esc')).toEqual({ ok: true, command: { type: 'press', press: { key: 'Escape' }, times: 1 } })
  })

  it('says what went wrong in plain words for an Answer', () => {
    expect(grammarErrorOf('press F5')).toBe("I can't press F5. Keys I know: up, down, left, right, space, enter, tab, escape.")
    expect(grammarErrorOf('press')).toBe('Press needs a key. Keys I know: up, down, left, right, space, enter, tab, escape.')
    expect(grammarErrorOf('press down zero')).toBe('Press takes a whole number of times, like “press down 3”.')
    expect(grammarErrorOf('scroll sideways')).toBe('I can scroll up or down, or a scrolling part of the page by its number, like “scroll 12 down”.')
    expect(grammarErrorOf('click seven')).toBe('Click needs the number of an item, like “click 7”.')
    expect(grammarErrorOf('volume 140')).toBe('Volume takes a number from 0 to 100, like “volume 40”.')
    expect(grammarErrorOf('dance now')).toBeNull()
    expect(grammarErrorOf('scroll down')).toBeNull()
  })

  it('rejects press with an unknown key or bad count', () => {
    expect(parseCliCommand('press')).toEqual({
      ok: false,
      error: "press: expected 'press <key> [times]' with key one of k, j, l, up, down, left, right, space, enter, tab, escape, esc, next",
    })
    expect(parseCliCommand('press qwerty')).toEqual({
      ok: false,
      error: "press: expected 'press <key> [times]' with key one of k, j, l, up, down, left, right, space, enter, tab, escape, esc, next",
    })
    expect(parseCliCommand('press k zero')).toEqual({
      ok: false,
      error: "press: times must be a positive integer",
    })
    expect(parseCliCommand('press k 0')).toEqual({ ok: false, error: 'press: times must be a positive integer' })
  })

  it('parses resume — the Last Page reopened', () => {
    expect(parseCliCommand('resume')).toEqual({ ok: true, command: { type: 'resume' } })
  })

  it('reads every exact music line to its Player verb (#343): `play` alone the unpause; a line with free words is Jev\'s (ADR 0079)', () => {
    const play = (line: string) => {
      const parsed = parseCliCommand(line)
      return parsed?.ok === true && parsed.command.type === 'play' ? { music: parsed.command.music } : parsed
    }
    for (const line of ['play bohemian rhapsody', 'Play Bohemian Rhapsody.', 'queue daft punk around the world', 'add daft punk', 'play daft punk next']) expect(parseCliCommand(line)).toMatchObject({ ok: false })
    expect(play('play')).toEqual({ music: { kind: 'unpause' } })
    expect(play('pause')).toEqual({ music: { kind: 'pause' } })
    for (const line of ['skip', 'next', 'next song', 'Next song.']) expect(play(line)).toEqual({ music: { kind: 'skip' } })
    for (const line of ['previous', 'last song', 'go back a song']) expect(play(line)).toEqual({ music: { kind: 'previous' } })
    for (const line of ['loop', 'repeat', 'repeat this song', 'loop this']) expect(play(line)).toEqual({ music: { kind: 'loop', on: true } })
    for (const line of ['loop off', 'stop looping']) expect(play(line)).toEqual({ music: { kind: 'loop', on: false } })
    for (const line of ['restart', 'play from the beginning', 'start over', 'from the top']) expect(play(line)).toEqual({ music: { kind: 'restart' } })
    expect(play('louder')).toEqual({ music: { kind: 'louder' } })
    expect(play('quieter')).toEqual({ music: { kind: 'quieter' } })
    expect(play('volume 40')).toEqual({ music: { kind: 'volume', to: 40 } })
    expect(play('mute')).toEqual({ music: { kind: 'mute', on: true } })
    expect(play('unmute')).toEqual({ music: { kind: 'mute', on: false } })
    expect(parseCliCommand('volume 140')).toMatchObject({ ok: false })
    // `back` stays history, `resume` the Task's (owner's ruling 3); "add to cart" is the page's.
    expect(parseCliCommand('back')).toEqual({ ok: true, command: { type: 'back' } })
    expect(parseCliCommand('resume')).toEqual({ ok: true, command: { type: 'resume' } })
    expect(parseCliCommand('add to cart')).toMatchObject({ ok: false })
  })

  it('reads the corrections and `forget this song` to their Player verbs (#345)', () => {
    const play = (line: string) => {
      const parsed = parseCliCommand(line)
      return parsed?.ok === true && parsed.command.type === 'play' ? { music: parsed.command.music } : parsed
    }
    for (const line of ['not that one', 'Not that one.', 'next result', 'the other one', 'wrong one']) {
      expect(play(line)).toEqual({ music: { kind: 'correct', step: 1 } })
    }
    expect(play('the one before')).toEqual({ music: { kind: 'correct', step: -1 } })
    expect(play('forget this song')).toEqual({ music: { kind: 'forget' } })
  })

  it('parses timer — a length, or off', () => {
    expect(parseCliCommand('timer 5m')).toEqual({ ok: true, command: { type: 'timer', durationMs: 300_000 } })
    expect(parseCliCommand('timer 2:30')).toEqual({ ok: true, command: { type: 'timer', durationMs: 150_000 } })
    expect(parseCliCommand('timer ten minutes')).toEqual({ ok: true, command: { type: 'timer', durationMs: 600_000 } })
    expect(parseCliCommand('timer off')).toEqual({ ok: true, command: { type: 'timer', durationMs: null } })
    expect(parseCliCommand('timer pasta')).toMatchObject({ ok: false })
    expect(parseCliCommand('timer')).toMatchObject({ ok: false })
  })

  it('parses reload (#328)', () => {
    expect(parseCliCommand('reload')).toEqual({ ok: true, command: { type: 'reload' } })
  })

  it('parses back, help, and quit/exit', () => {
    expect(parseCliCommand('back')).toEqual({ ok: true, command: { type: 'back' } })
    expect(parseCliCommand('help')).toEqual({ ok: true, command: { type: 'help' } })
    expect(parseCliCommand('quit')).toEqual({ ok: true, command: { type: 'quit' } })
    expect(parseCliCommand('exit')).toEqual({ ok: true, command: { type: 'quit' } })
  })

  it('reads a verb that takes no words only alone: words past it make no grammar line (#368)', () => {
    for (const line of ['back to the results', 'read the comments', 'read_page now', 'reload the comments', 'resume the video', 'help me', 'quit it', 'exit the menu']) {
      expect(parseCliCommand(line)).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown command/) })
    }
  })

  it('treats blank lines as no command', () => {
    expect(parseCliCommand('')).toBeNull()
    expect(parseCliCommand('   ')).toBeNull()
  })

  it('reports unknown commands', () => {
    expect(parseCliCommand('frobnicate now')).toEqual({ ok: false, error: "unknown command: 'frobnicate' — try 'help'" })
  })
})

describe('the menu verb (#363, ADR 0079)', () => {
  it('parses menu with a ref number, and names the error in plain words', () => {
    expect(parseCliCommand('menu 7')).toEqual({ ok: true, command: { type: 'menu', ref: 7 } })
    expect(parseCliCommand('menu')).toEqual({ ok: false, error: "menu: expected a ref number, e.g. 'menu 7'" })
    expect(grammarErrorOf('menu the player')).toBe('Menu needs the number of an item, like “menu 7”.')
  })
})
