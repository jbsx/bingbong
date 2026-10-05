import { describe, expect, it } from 'vitest'
import { VOICE_FAILED_LINE, VOICE_UNAVAILABLE_LINE } from './voiceFailureLines'

// The texts themselves are the decision (#315): a line shown for a voice
// failure names no error. The Run's line is also pinned where the
// pipeline emits it; the other has no seam of its own to pin it at.
describe('the lines shown when a voice failure is reported (#315)', () => {
  it('name no error, in a Run and outside one', () => {
    expect(VOICE_FAILED_LINE).toBe('Something went wrong.')
    expect(VOICE_UNAVAILABLE_LINE).toBe('Voice unavailable.')
  })
})
