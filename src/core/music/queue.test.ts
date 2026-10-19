import { describe, expect, it } from 'vitest'
import { EMPTY_QUEUE, advance, enqueue, pause, playNow, previous, replaceCurrent, setLoop, unpause, type Song } from './queue'

// The Queue (CONTEXT.md, #343): the song playing, the songs after it and
// the songs before it — pure state the Player in main keeps in step with
// the watch page's video.

const a: Song = { id: 'aaaaaaaaaaa', title: 'A' }
const b: Song = { id: 'bbbbbbbbbbb', title: 'B' }
const c: Song = { id: 'ccccccccccc', title: 'C' }

describe('the Queue', () => {
  it('`queue` appends after what is queued, and says where the song sits', () => {
    const playing = playNow(EMPTY_QUEUE, a)
    const first = enqueue(playing, b, 'end')
    const second = enqueue(first.queue, c, 'end')
    expect(second.queue.current).toEqual(a)
    expect(second.queue.upNext).toEqual([b, c])
    expect([first.position, second.position]).toEqual([1, 2])
    expect(second.playsNow).toBe(false)
  })

  it('`play … next` inserts at the front', () => {
    const queued = enqueue(playNow(EMPTY_QUEUE, a), b, 'end').queue
    const next = enqueue(queued, c, 'front')
    expect(next.queue.upNext).toEqual([c, b])
    expect(next.position).toBe(1)
  })

  it('a song queued with nothing playing plays now', () => {
    const queued = enqueue(EMPTY_QUEUE, a, 'end')
    expect(queued.playsNow).toBe(true)
    expect(queued.queue.current).toEqual(a)
    expect(queued.queue.upNext).toEqual([])
  })

  it('`skip` plays the next queued song', () => {
    const queued = enqueue(playNow(EMPTY_QUEUE, a), b, 'end').queue
    const skipped = advance(queued)
    expect(skipped.next).toEqual(b)
    expect(skipped.queue.current).toEqual(b)
    expect(skipped.queue.upNext).toEqual([])
    expect(skipped.queue.played).toEqual([a])
  })

  it('`skip` on an empty queue stops: nothing is current, and nothing plays', () => {
    const skipped = advance(playNow(EMPTY_QUEUE, a))
    expect(skipped.next).toBeNull()
    expect(skipped.queue.current).toBeNull()
    expect(skipped.queue.played).toEqual([a])
  })

  it('`previous` returns to the song before, the current one next again', () => {
    const skipped = advance(enqueue(playNow(EMPTY_QUEUE, a), b, 'end').queue).queue
    const back = previous(skipped)
    expect(back.song).toEqual(a)
    expect(back.queue.current).toEqual(a)
    expect(back.queue.upNext).toEqual([b])
    expect(back.queue.played).toEqual([])
  })

  it('`previous` with nothing before is nothing', () => {
    const back = previous(playNow(EMPTY_QUEUE, a))
    expect(back.song).toBeNull()
    expect(back.queue.current).toEqual(a)
  })

  it('`previous` after the queue ran out returns to the last song', () => {
    const stopped = advance(playNow(EMPTY_QUEUE, a)).queue
    expect(previous(stopped).queue.current).toEqual(a)
  })

  it('loop survives `pause`, and `skip` clears it', () => {
    const looping = setLoop(enqueue(playNow(EMPTY_QUEUE, a), b, 'end').queue, true)
    const paused = pause(looping)
    expect(paused.loop).toBe(true)
    expect(paused.paused).toBe(true)
    expect(unpause(paused)).toMatchObject({ loop: true, paused: false })
    expect(advance(paused).queue.loop).toBe(false)
  })

  it('`play <words>` replaces the current song and keeps the queue', () => {
    const queued = setLoop(enqueue(playNow(EMPTY_QUEUE, a), b, 'end').queue, true)
    const replaced = playNow(pause(queued), c)
    expect(replaced.current).toEqual(c)
    expect(replaced.upNext).toEqual([b])
    expect(replaced.played).toEqual([a])
    expect(replaced).toMatchObject({ loop: false, paused: false })
  })

  it('a correction (#345) puts the next result in the wrong pick\'s place: never played, so `previous` passes it by', () => {
    const corrected = replaceCurrent(setLoop(playNow(playNow(EMPTY_QUEUE, a), b), true), c)
    expect(corrected.current).toEqual(c)
    expect(corrected.played).toEqual([a])
    expect(corrected.loop).toBe(false)
  })
})
