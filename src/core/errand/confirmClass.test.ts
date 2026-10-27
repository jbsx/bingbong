import { describe, expect, it } from 'vitest'
import type { Command, CommandPage } from '../command/command'
import { confirmLine, confirmOf, isYes, leavingWordOf } from './confirmClass'

const page: CommandPage = {
  url: 'https://www.youtube.com/watch?v=x',
  title: 'A video',
  refs: [
    { ref: 1, kind: 'input', label: 'Add a comment…', href: null, inputType: 'text' },
    { ref: 2, kind: 'button', label: 'Comment', href: null, inputType: null },
    { ref: 3, kind: 'button', label: 'Comments', href: null, inputType: null },
    { ref: 4, kind: 'button', label: 'Share', href: null, inputType: null },
    { ref: 5, kind: 'button', label: 'Place your order', href: null, inputType: null },
  ],
}
const click = (target: number): Command => ({ verb: 'click', target, slot: null })

describe('leavingWordOf (#467): the words that make a control leave the appliance, by kind, never by site', () => {
  it.each([
    ['Post', 'post'],
    ['Send message', 'send'],
    ['Pay now', 'pay'],
    ['Buy it now', 'buy'],
    ['Place your order', 'order'],
    ['Delete video', 'delete'],
    ['Submit', 'submit'],
    ['Publish', 'publish'],
    ['Reply', 'reply'],
    ['Comment', 'comment'],
    ['SUBSCRIBE', 'subscribe'],
    ['Unsubscribe', 'unsubscribe'],
  ])('%j carries %j', (label, word) => {
    expect(leavingWordOf(label)).toBe(word)
  })

  it.each(['Comments', 'Share', 'Subscribed', 'Posts', 'Like', 'Show more', 'Replies'])('%j carries none', (label) => {
    expect(leavingWordOf(label)).toBeNull()
  })
})

describe('confirmOf (#467): what is said back before an action, or null when it stays', () => {
  it('a click on a control whose label leaves is said back whatever the Planner said, with the text typed before it', () => {
    expect(confirmOf({ command: click(2), page, plannerClass: 'stays', typed: [{ text: 'this is great', into: 'Add a comment…' }] })).toEqual({ verb: 'comment', what: 'this is great' })
  })

  it('a click on one with no text typed says the control', () => {
    expect(confirmOf({ command: click(5), page, plannerClass: 'stays', typed: [] })).toEqual({ verb: 'order', what: '“Place your order”' })
  })

  it('a click the Planner names leaves is said back by its own verb', () => {
    expect(confirmOf({ command: click(4), page, plannerClass: 'leaves', typed: [] })).toEqual({ verb: 'click', what: '“Share”' })
  })

  it('a click that stays and carries no such word is not', () => {
    expect(confirmOf({ command: click(3), page, plannerClass: 'stays', typed: [] })).toBeNull()
    expect(confirmOf({ command: click(4), page, plannerClass: 'stays', typed: [{ text: 'x', into: 'Add a comment…' }] })).toBeNull()
  })

  it('an Enter after typing into a field whose label leaves sends what was typed', () => {
    const enter: Command = { verb: 'press', target: null, slot: 'Enter', key: { key: 'Enter' }, times: 1 }
    expect(confirmOf({ command: enter, page, plannerClass: 'stays', typed: [{ text: 'hi there', into: 'Reply to Ana' }] })).toEqual({ verb: 'reply', what: 'hi there' })
    expect(confirmOf({ command: enter, page, plannerClass: 'stays', typed: [{ text: 'shoes', into: 'Search' }] })).toBeNull()
    expect(confirmOf({ command: enter, page, plannerClass: 'leaves', typed: [{ text: 'shoes', into: 'Search' }] })).toEqual({ verb: 'press Enter on', what: 'shoes' })
    // Every field typed into on the page, not the last (#468): a reply typed, then a search, and the Enter may still send the reply.
    expect(confirmOf({ command: enter, page, plannerClass: 'stays', typed: [{ text: 'hi there', into: 'Reply to Ana' }, { text: 'shoes', into: 'Search' }] })).toEqual({ verb: 'reply', what: 'hi there' })
  })

  it('an Escape or a Tab never leaves by the policy', () => {
    const escape: Command = { verb: 'press', target: null, slot: 'Escape', key: { key: 'Escape' }, times: 1 }
    expect(confirmOf({ command: escape, page, plannerClass: 'stays', typed: [{ text: 'x', into: 'Post a reply' }] })).toBeNull()
  })

  it('a type that submits a field whose label leaves sends its own words', () => {
    const typed: Command = { verb: 'type', target: 1, slot: 'this is great', submit: true }
    const field = { ...page, refs: [{ ref: 1, kind: 'input' as const, label: 'Post a comment', href: null, inputType: 'text' }] }
    expect(confirmOf({ command: typed, page: field, plannerClass: 'stays', typed: [] })).toEqual({ verb: 'post', what: 'this is great' })
  })

  it('a plain type stays: nothing has left until it is sent', () => {
    expect(confirmOf({ command: { verb: 'type', target: 1, slot: 'this is great' }, page, plannerClass: 'stays', typed: [] })).toBeNull()
  })
})

describe('the confirm said and answered (#467): the Site Question road', () => {
  it('says what will happen and asks yes or no', () => {
    expect(confirmLine({ verb: 'comment', what: 'this is great' })).toBe('This will comment: this is great. Yes or no?')
    expect(confirmLine({ verb: 'post', what: 'Done.' })).toBe('This will post: Done. Yes or no?')
  })

  it('only an exact yes fires it', () => {
    for (const line of ['yes', 'Yes.', 'ok', 'okay', 'confirm']) expect(isYes(line)).toBe(true)
    for (const line of ['no', 'cancel', 'yes but change it', 'sure why not', '', 'never mind']) expect(isYes(line)).toBe(false)
  })
})
