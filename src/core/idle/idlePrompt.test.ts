import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../pipeline/events'
import { foldIdleReply, idleReplyDone, NO_REPLY, sentReply, type IdleReply } from './idlePrompt'

// The Idle Prompt's reply (#361): the Answer of the line typed into it.

const fold = (reply: IdleReply, events: PipelineEvent[]): IdleReply => events.reduce(foldIdleReply, reply)

describe('the Idle Prompt reply', () => {
  it('shows the Answer of the Command its line became', () => {
    const reply = fold(sentReply('scroll down'), [
      { type: 'command', turnId: 't1', text: 'scroll down', action: 'scroll down', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 1 },
      { type: 'display', turnId: 't1', text: 'There is no page to scroll.', failure: true, at: 2 },
    ])
    expect(reply).toMatchObject({ kind: 'answer', answer: 'There is no page to scroll.', failure: true, muted: false })
  })

  it('waits for its own line: another Command and its Answer are not its reply', () => {
    const reply = fold(sentReply('timer 5 minutes'), [
      { type: 'command', turnId: 'v1', text: 'stop', action: 'stop', task: { id: 'v1', hop: 0 }, at: 1 },
      { type: 'display', turnId: 'v1', text: 'Stopped.', muted: true, at: 2 },
    ])
    expect(reply).toEqual({ kind: 'sent', text: 'timer 5 minutes' })
  })

  it('follows the Task past its first hop to the Answer of a later one', () => {
    const reply = fold(sentReply('read'), [
      { type: 'command', turnId: 't1', text: 'read', action: 'read', task: { id: 't1', hop: 0 }, at: 1 },
      { type: 'command', turnId: 't2', text: 'read', action: 'read', task: { id: 't1', hop: 1 }, at: 2 },
      { type: 'display', turnId: 't2', text: 'Nothing to read.', at: 3 },
    ])
    expect(reply).toMatchObject({ kind: 'answer', answer: 'Nothing to read.', turns: ['t1', 't2'] })
  })

  it('shows a line read as no Command as its words, muted', () => {
    const reply = fold(sentReply('hmm'), [{ type: 'command', turnId: 't1', text: 'hmm', action: 'hmm', dropped: true, at: 1 }])
    expect(reply).toMatchObject({ kind: 'answer', answer: 'hmm', muted: true })
  })

  it('is done once its Command answers over the screen, as a `play` does', () => {
    const working = fold(sentReply('play fixture song'), [{ type: 'command', turnId: 't1', text: 'play fixture song', action: 'play fixture song', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 1 }])
    expect(idleReplyDone(working)).toBe(false)
    expect(idleReplyDone(fold(working, [{ type: 'display', turnId: 't1', text: 'Playing “Fixture Song”.', at: 2 }]))).toBe(true)
    expect(idleReplyDone(fold(working, [{ type: 'display', turnId: 't1', text: 'Stopped.', muted: true, at: 2 }]))).toBe(true)
  })

  it('is not done on a failure, nor on a line read as no Command: both stay to be read', () => {
    const working = fold(sentReply('scroll down'), [{ type: 'command', turnId: 't1', text: 'scroll down', action: 'scroll down', keepsIdle: true, task: { id: 't1', hop: 0 }, at: 1 }])
    expect(idleReplyDone(fold(working, [{ type: 'display', turnId: 't1', text: "There's no page open.", failure: true, at: 2 }]))).toBe(false)
    expect(idleReplyDone(fold(sentReply('hmm'), [{ type: 'command', turnId: 't1', text: 'hmm', action: 'hmm', dropped: true, at: 1 }]))).toBe(false)
    expect(idleReplyDone(NO_REPLY)).toBe(false)
  })

  it('stays none with nothing sent', () => {
    expect(fold(NO_REPLY, [{ type: 'display', turnId: 't1', text: 'x', at: 1 }])).toBe(NO_REPLY)
  })
})
