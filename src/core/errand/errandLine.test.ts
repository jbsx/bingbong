import { describe, expect, it } from 'vitest'
import { HANDS_OFF, errandGoalOf } from './errandLine'

describe('how an Errand is reached (#467, #468, ADR 0095)', () => {
  it('`errand <words>` carries its Goal Line', () => {
    expect(errandGoalOf('errand Comment "this is great" on this video.')).toBe('Comment "this is great" on this video.')
    expect(errandGoalOf('  Errand   find me a cheaper one ')).toBe('find me a cheaper one')
  })

  it('no other line is one', () => {
    for (const line of ['errand', 'errands to run', 'run an errand for me', 'comment this is great']) expect(errandGoalOf(line)).toBeNull()
  })

  it('a Task ending cap, unsure or unavailable hands its line over; no other end does', () => {
    expect([...HANDS_OFF].sort()).toEqual(['cap', 'unavailable', 'unsure'])
  })
})
