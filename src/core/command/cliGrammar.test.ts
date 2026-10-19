import { describe, expect, it } from 'vitest'
import { parseCliCommand } from './cliGrammar'

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

  it('rejects press with an unknown key or bad count', () => {
    expect(parseCliCommand('press')).toEqual({
      ok: false,
      error: "press: expected 'press <key> [times]' with key one of k, j, l, up, down, left, right, space, enter, next",
    })
    expect(parseCliCommand('press qwerty')).toEqual({
      ok: false,
      error: "press: expected 'press <key> [times]' with key one of k, j, l, up, down, left, right, space, enter, next",
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

  it('reads every music line to its Player verb (#343): `play <words>` a search, `play` alone the unpause', () => {
    const play = (line: string) => {
      const parsed = parseCliCommand(line)
      return parsed?.ok === true && parsed.command.type === 'play' ? { music: parsed.command.music, words: parsed.command.words } : parsed
    }
    expect(play('play bohemian rhapsody')).toEqual({ music: { kind: 'search', place: 'now' }, words: 'bohemian rhapsody' })
    expect(play('Play Bohemian Rhapsody.')).toEqual({ music: { kind: 'search', place: 'now' }, words: 'Bohemian Rhapsody' })
    expect(play('queue daft punk around the world')).toEqual({ music: { kind: 'search', place: 'end' }, words: 'daft punk around the world' })
    expect(play('add daft punk')).toEqual({ music: { kind: 'search', place: 'end' }, words: 'daft punk' })
    expect(play('play daft punk next')).toEqual({ music: { kind: 'search', place: 'front' }, words: 'daft punk' })
    expect(play('play')).toEqual({ music: { kind: 'unpause' }, words: null })
    expect(play('pause')).toEqual({ music: { kind: 'pause' }, words: null })
    for (const line of ['skip', 'next', 'next song', 'Next song.']) expect(play(line)).toEqual({ music: { kind: 'skip' }, words: null })
    for (const line of ['previous', 'last song', 'go back a song']) expect(play(line)).toEqual({ music: { kind: 'previous' }, words: null })
    for (const line of ['loop', 'repeat', 'repeat this song', 'loop this']) expect(play(line)).toEqual({ music: { kind: 'loop', on: true }, words: null })
    for (const line of ['loop off', 'stop looping']) expect(play(line)).toEqual({ music: { kind: 'loop', on: false }, words: null })
    for (const line of ['restart', 'play from the beginning', 'start over', 'from the top']) expect(play(line)).toEqual({ music: { kind: 'restart' }, words: null })
    expect(play('louder')).toEqual({ music: { kind: 'louder' }, words: null })
    expect(play('quieter')).toEqual({ music: { kind: 'quieter' }, words: null })
    expect(play('volume 40')).toEqual({ music: { kind: 'volume', to: 40 }, words: null })
    expect(play('mute')).toEqual({ music: { kind: 'mute', on: true }, words: null })
    expect(play('unmute')).toEqual({ music: { kind: 'mute', on: false }, words: null })
    expect(parseCliCommand('volume 140')).toMatchObject({ ok: false })
    // `back` stays history, `resume` the Task's (owner's ruling 3); "add to cart" is the page's.
    expect(parseCliCommand('back')).toEqual({ ok: true, command: { type: 'back' } })
    expect(parseCliCommand('resume')).toEqual({ ok: true, command: { type: 'resume' } })
    expect(parseCliCommand('add to cart')).toMatchObject({ ok: false })
  })

  it('reads the corrections and `forget this song` to their Player verbs (#345)', () => {
    const play = (line: string) => {
      const parsed = parseCliCommand(line)
      return parsed?.ok === true && parsed.command.type === 'play' ? { music: parsed.command.music, words: parsed.command.words } : parsed
    }
    for (const line of ['not that one', 'Not that one.', 'next result', 'the other one', 'wrong one']) {
      expect(play(line)).toEqual({ music: { kind: 'correct', step: 1 }, words: null })
    }
    expect(play('the one before')).toEqual({ music: { kind: 'correct', step: -1 }, words: null })
    expect(play('forget this song')).toEqual({ music: { kind: 'forget' }, words: null })
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

  it('treats blank lines as no command', () => {
    expect(parseCliCommand('')).toBeNull()
    expect(parseCliCommand('   ')).toBeNull()
  })

  it('reports unknown commands', () => {
    expect(parseCliCommand('frobnicate now')).toEqual({ ok: false, error: "unknown command: 'frobnicate' — try 'help'" })
  })
})
