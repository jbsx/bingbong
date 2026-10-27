import { describe, expect, it } from 'vitest'
import { SCROLL_END_OF_PAGE } from './scrollDelta'

describe('a scroll that moved nothing', () => {
  it('names the end of the page with the note the repeat guard reads', () => {
    expect(SCROLL_END_OF_PAGE).toBe('end of page')
  })
})
