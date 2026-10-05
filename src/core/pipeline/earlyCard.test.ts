import { describe, expect, it } from 'vitest'

import { streamedCard } from '../agent/answerContract'
import { createCardWatch } from './earlyCard'

// Issue #319 (ADR 0074): the Card's fields come first in the Answer object,
// so they have closed in the stream long before the Answer Tail has.

const CARD = '{"speak":"It is 42.","display":"# The answer is 42.","evidence_ids":["memory-1"],"asked_items":[{"n":1,"standing":"stated","statement":"42"}]'

describe('the Card read from a streamed Answer (#319)', () => {
  it('is closed when asked_items closes, before any of the Answer Tail', () => {
    const read = streamedCard(CARD)
    expect(read).toMatchObject({
      order: 'in_order',
      card: {
        shape: 'on_contract',
        speak: 'It is 42.',
        display: '# The answer is 42.',
        evidenceIds: ['memory-1'],
        askedItems: [{ n: 1, standing: 'stated', statement: '42' }],
      },
    })
  })

  it('is not closed while asked_items is still being written', () => {
    expect(streamedCard(CARD.slice(0, -1))).toBeNull()
    expect(streamedCard('{"speak":"It is 42.","display":"# The answer is 42."')).toBeNull()
    expect(streamedCard('{"speak":"It is 42.","display":"# The answer is 42.","evidence_ids":["memory-1"],')).toBeNull()
    // A Card field that has opened is still to come, whatever closed before it.
    expect(streamedCard('{"speak":"It is 42.","display":"# The answer is 42.","inspection_candidate_id":')).toBeNull()
  })

  it('is closed without asked_items once a key of the Answer Tail opens, or the object ends', () => {
    expect(streamedCard('{"speak":"Done.","display":"Paused the video.","resolution":')).toMatchObject({
      order: 'in_order',
      card: { speak: 'Done.', display: 'Paused the video.' },
    })
    expect(streamedCard('{"speak":"Done.","display":"Paused the video.","resolution"')).toBeNull()
    expect(streamedCard('{"speak":"Done.","display":"Paused the video."}')).toMatchObject({ order: 'in_order' })
  })

  it('leaves the Answer Tail out of the Card', () => {
    const read = streamedCard(`${CARD},"resolution":"completed","run_note":"The answer was 42.","checkpoints":[{"observation":"x"`)
    expect(read).toMatchObject({ order: 'in_order' })
    expect(read?.order === 'in_order' ? read.card : null).not.toHaveProperty('resolution')
    expect(read?.order === 'in_order' ? read.card : null).not.toHaveProperty('runNote')
  })

  it('reads braces, brackets, quotes and escapes inside a value as the value', () => {
    const read = streamedCard('{"speak":"He said \\"}\\".","display":"a, b] and {c}\\\\","asked_items":[{"n":1,"standing":"stated","statement":"[x], {y}"}]')
    expect(read).toMatchObject({
      order: 'in_order',
      card: { speak: 'He said "}".', display: 'a, b] and {c}\\', askedItems: [{ statement: '[x], {y}' }] },
    })
  })

  it('reads the object behind a preamble', () => {
    expect(streamedCard(`All verified.\n\n${CARD}`)).toMatchObject({ order: 'in_order', card: { display: '# The answer is 42.' } })
  })

  it('names an object whose Card fields do not lead it, in order, as out of order', () => {
    // The order the prompt's example had before ADR 0074.
    expect(streamedCard('{"speak":"It is 42.","display":"# 42","run_note":"n","memory_patch":[],"evidence_ids":')).toEqual({ order: 'out_of_order' })
    expect(streamedCard('{"display":')).toEqual({ order: 'out_of_order' })
    expect(streamedCard('{"speak":"a","evidence_ids":[],"display":')).toEqual({ order: 'out_of_order' })
    expect(streamedCard('{"speak":"a","display":"b","asked_items":[],"evidence_ids":')).toEqual({ order: 'out_of_order' })
    expect(streamedCard('{"speak":"a","display":"b","display":')).toEqual({ order: 'out_of_order' })
  })

  it('reads nothing from prose, or from an object that has not opened a key', () => {
    expect(streamedCard('The answer is 42.')).toBeNull()
    expect(streamedCard('{')).toBeNull()
    expect(streamedCard('{"spe')).toBeNull()
  })

  it('hands back a Card whose fields are not the contract’s shape as it parses: not on contract', () => {
    expect(streamedCard('{"speak":"a","display":7,"resolution":')).toMatchObject({ order: 'in_order', card: { shape: 'malformed' } })
  })
})

describe('one round’s watch for its Card (#319)', () => {
  it('settles once, when the Card’s fields have closed across fragments', async () => {
    const watch = createCardWatch()
    let settled = false
    void watch.ready.then(() => {
      settled = true
    })
    watch.onText('{"speak":"It is 42.","dis')
    watch.onText('play":"# The answer is 42.","asked_items":[{"n":1,"standing":"stated","statement":"42"}')
    await Promise.resolve()
    expect(settled).toBe(false)
    watch.onText('],"resolution":"completed"')
    expect(await watch.ready).toMatchObject({ display: '# The answer is 42.', askedItems: [{ n: 1 }] })
    expect(watch.outOfOrder()).toBe(false)
    expect(watch.abandoned).toBe(false)
  })

  it('never settles for an Answer out of field order, and says so', async () => {
    const watch = createCardWatch()
    let settled = false
    void watch.ready.then(() => {
      settled = true
    })
    watch.onText('{"speak":"It is 42.","display":"# 42","run_note":"n","evidence_ids":["memory-1"],"asked_items":[]}')
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(watch.outOfOrder()).toBe(true)
  })

  it('never settles for a Card that is not on contract', async () => {
    const watch = createCardWatch()
    let settled = false
    void watch.ready.then(() => {
      settled = true
    })
    watch.onText('{"speak":"a","display":7,"resolution":"completed"}')
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(watch.outOfOrder()).toBe(false)
  })

  it('drops a retried attempt’s text, and marks a Card it had closed as abandoned', async () => {
    const open = createCardWatch()
    open.onText('{"speak":"It is 42.","display":"# The ans')
    open.restart()
    expect(open.abandoned).toBe(false)
    open.onText('{"speak":"Yes.","display":"# Yes.","resolution":')
    expect(await open.ready).toMatchObject({ display: '# Yes.' })

    const closed = createCardWatch()
    closed.onText('{"speak":"It is 42.","display":"# 42.","resolution":')
    await closed.ready
    closed.restart()
    expect(closed.abandoned).toBe(true)
  })
})
