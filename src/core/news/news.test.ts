import { describe, expect, it } from 'vitest'
import { headline, leadAndTail } from './news'

describe('leadAndTail', () => {
  it('splits a long headline at a clause break, keeping the "and" that starts the tail', () => {
    expect(
      leadAndTail(
        'Claude Code’s new harness lets a coding agent run your whole test suite in parallel across machines, and the agents now review each other’s pull requests before a human sees them',
      ),
    ).toEqual({
      lead: 'Claude Code’s new harness lets a coding agent run your whole test suite in parallel across machines',
      tail: 'and the agents now review each other’s pull requests before a human sees them',
    })
  })

  it('drops a colon or a dash, and keeps the "with" that starts the tail', () => {
    expect(leadAndTail('GPT-6 benchmarks: what the new evals do and do not measure')).toEqual({ lead: 'GPT-6 benchmarks', tail: 'what the new evals do and do not measure' })
    expect(leadAndTail('Frontier lab publishes the weights of its largest open model yet, with a 400-page report')).toEqual({
      lead: 'Frontier lab publishes the weights of its largest open model yet',
      tail: 'with a 400-page report',
    })
    expect(leadAndTail('The agent harness wars — who owns the loop')).toEqual({ lead: 'The agent harness wars', tail: 'who owns the loop' })
  })

  it('takes the stronger break over an earlier comma', () => {
    expect(leadAndTail('Rust in the Linux kernel, five years on: what changed')).toEqual({ lead: 'Rust in the Linux kernel, five years on', tail: 'what changed' })
  })

  it('does not break a lead shorter than fifteen characters, and keeps a title with no break whole', () => {
    expect(leadAndTail('Show HN: A terminal that remembers every command you ran')).toEqual({ lead: 'Show HN: A terminal that remembers every command you ran', tail: null })
    expect(leadAndTail('Markets slide as chip export rules tighten again')).toEqual({ lead: 'Markets slide as chip export rules tighten again', tail: null })
  })

  it('sets a GitHub repo as its name, then its description', () => {
    expect(leadAndTail('stablyai/orca: Orca is the place for working with a fleet of agents. Run any coding agent.')).toEqual({
      lead: 'stablyai/orca',
      tail: 'Orca is the place for working with a fleet of agents.',
    })
  })
})

describe('headline', () => {
  it('sets a GitHub repo as its name over the first sentence of its description', () => {
    expect(
      headline(
        'stablyai/orca: Orca is the place for working with a fleet of agents (e.g. Grok Bot, Claude Code). Run any coding agent with your own subscription. Available on desktop, mobile and remote runtime.',
      ),
    ).toEqual({ title: 'stablyai/orca', dek: 'Orca is the place for working with a fleet of agents (e.g. Grok Bot, Claude Code).' })
  })

  it('keeps a description of one sentence whole', () => {
    expect(headline('shiyu-coder/Kronos: Kronos: A Foundation Model for the Language of Financial Markets')).toEqual({
      title: 'shiyu-coder/Kronos',
      dek: 'Kronos: A Foundation Model for the Language of Financial Markets',
    })
  })

  it('leaves any other title as its own headline', () => {
    expect(headline('Show HN: A terminal that remembers every command you ran')).toEqual({ title: 'Show HN: A terminal that remembers every command you ran', dek: null })
    expect(headline('LEV: Thinking Fast and Deep with Looped Decision Models')).toEqual({ title: 'LEV: Thinking Fast and Deep with Looped Decision Models', dek: null })
    expect(headline('withmarbleapp/os-taxonomy')).toEqual({ title: 'withmarbleapp/os-taxonomy', dek: null })
  })
})
