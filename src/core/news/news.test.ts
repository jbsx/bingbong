import { describe, expect, it } from 'vitest'
import { headline } from './news'

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
