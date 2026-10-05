import { describe, expect, it } from 'vitest'
import { answerReplyEvent } from './answerReplyTrace'
import { TRACE_ANSWER_REPLY_MAX_CHARS } from './runTrace'

// Issue #318: the reply is kept as the model wrote it, so the record is the
// only place an Answer's Tail and its keys can be read.

const REPLY = '{"speak":"Yes.","display":"A guitar travels free.","run_note":"checked the luggage page"}'

describe('answerReplyEvent', () => {
  it('keeps the round, how the reply was read, its shape and the text whole', () => {
    expect(answerReplyEvent({ round: 7, read: 'accepted', shape: 'on_contract', reserved: false, text: REPLY })).toEqual({
      kind: 'answer_reply',
      round: 7,
      read: 'accepted',
      shape: 'on_contract',
      text: REPLY,
      chars: REPLY.length,
    })
  })

  it('marks a reserved round, and says nothing of a shape the client did not give', () => {
    const record = answerReplyEvent({ round: 25, read: 'off_contract', reserved: true, text: 'prose' })

    expect(record).toMatchObject({ reserved: true })
    expect(record).not.toHaveProperty('shape')
  })

  it('cuts a reply past the cap and keeps the cut visible', () => {
    const text = 'x'.repeat(TRACE_ANSWER_REPLY_MAX_CHARS + 500)

    expect(answerReplyEvent({ round: 1, read: 'accepted', reserved: false, text })).toMatchObject({
      text: 'x'.repeat(TRACE_ANSWER_REPLY_MAX_CHARS),
      chars: text.length,
    })
  })
})
