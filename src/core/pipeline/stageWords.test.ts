import { describe, expect, it } from 'vitest'
import type { Command, CommandPage } from '../command/command'
import { actingWords, stageLine } from './stageWords'

// One vocabulary for a Command's stages (#438, principle 9): the Status
// Capsule and the Feed name the same stage with the same word, and the
// object is said in the person's words, never the raw action line.

const command = (verb: Command['verb'], more: Partial<Command> = {}): Command => ({ verb, target: null, slot: null, ...more })
const page: CommandPage = { url: 'https://example.com/', title: 'Example', refs: [{ ref: 4, kind: 'button', label: 'Sign in', href: null, inputType: null }] } as unknown as CommandPage

describe('actingWords', () => {
  it('opens a site by its host, not the address', () => {
    expect(actingWords(command('navigate', { slot: 'http://127.0.0.1:41234/held-response' }))).toEqual({ word: 'Opening', object: '127.0.0.1' })
    expect(actingWords(command('navigate', { slot: 'https://www.bbc.co.uk/news' }))).toEqual({ word: 'Opening', object: 'bbc.co.uk' })
    expect(actingWords(command('navigate', { slot: 'youtube' }))).toEqual({ word: 'Opening', object: 'youtube' })
  })

  it('searches for the words, on the site when scoped', () => {
    expect(actingWords(command('search', { slot: 'lighthouses' }))).toEqual({ word: 'Searching', object: '“lighthouses”' })
    // A Capture Op (#466) by what it takes.
    expect(actingWords(command('capture', { target: 4, capture: { kind: 'link', named: 'Home' } }))).toEqual({ word: 'Copying', object: 'the link' })
    expect(actingWords(command('capture', { capture: { kind: 'page', named: '' } }))).toEqual({ word: 'Copying', object: 'the page' })
    expect(actingWords(command('search', { slot: 'cats', site: 'youtube.com' }))).toEqual({ word: 'Searching', object: 'youtube.com for “cats”' })
    expect(actingWords(command('type', { slot: 'cats', target: 4, submit: true }))).toEqual({ word: 'Searching', object: '“cats”' })
  })

  it('clicks the control by its label, or its number when it has none', () => {
    expect(actingWords(command('click', { target: 4 }), page)).toEqual({ word: 'Clicking', object: '“Sign in”' })
    expect(actingWords(command('click', { target: 9 }), page)).toEqual({ word: 'Clicking', object: 'item 9' })
    expect(actingWords(command('click', { target: 4, dismiss: true }), page)).toEqual({ word: 'Closing', object: 'the pop-up' })
  })

  it('says the music it plays', () => {
    expect(actingWords(command('play', { slot: 'daft punk', music: { kind: 'search', place: 'now' } as Command['music'] }))).toEqual({ word: 'Playing', object: 'daft punk' })
  })

  it('is "Acting" with no object for a verb with no words of its own', () => {
    expect(actingWords(command('timer', { durationMs: 60_000 }))).toEqual({ word: 'Acting' })
  })
})

describe('stageLine', () => {
  it('is the Capsule\'s word for the stage, with the object the action named', () => {
    expect(stageLine('thinking')).toBe('Thinking')
    expect(stageLine('acting', { word: 'Opening', object: 'example.com' })).toBe('Opening example.com')
    expect(stageLine('loading', { word: 'Opening', object: 'example.com' })).toBe('Loading example.com')
    expect(stageLine('loading')).toBe('Loading')
    expect(stageLine('speaking')).toBe('Speaking')
    expect(stageLine('cancelled')).toBe('Stopped')
  })
})
