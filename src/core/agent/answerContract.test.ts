import { describe, expect, it } from 'vitest'
import { capSentences, parseAssistantAnswer, partialAnswerText, spokenErrorLine } from './answerContract'

describe('capSentences', () => {
  it('keeps the first n sentences', () => {
    expect(capSentences('One. Two. Three four.', 2)).toBe('One. Two.')
    expect(capSentences('One! Two? Three.', 1)).toBe('One!')
  })

  it('returns short text unchanged, including without ending punctuation', () => {
    expect(capSentences('All good', 2)).toBe('All good')
    expect(capSentences('One sentence only.', 2)).toBe('One sentence only.')
  })

  it('returns an empty string for blank text', () => {
    expect(capSentences('   ', 2)).toBe('')
  })
})

describe('parseAssistantAnswer', () => {
  it('reads speak and display from a JSON object, capping spoken sentences', () => {
    const answer = parseAssistantAnswer('{"speak":"One. Two. Three.","display":"# Full detail\\nwith markdown"}')

    expect(answer).toEqual({ speak: 'One. Two.', display: '# Full detail\nwith markdown' })
  })

  it('extracts a hidden Run Note without changing the visible Answer', () => {
    const answer = parseAssistantAnswer(
      '{"speak":"Done.","display":"Useful detail.","run_note":"  Ruled out option A; option B remains.  "}',
    )

    expect(answer).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      runNote: 'Ruled out option A; option B remains.',
    })
  })

  it.each([null, 42, '', ' '.repeat(2), 'x'.repeat(1_201)])(
    'preserves a valid Answer while marking malformed Run Note %j',
    (runNote) => {
      const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', run_note: runNote }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', runNoteIssue: 'malformed' })
    },
  )

  it('accepts JSON wrapped in a code fence', () => {
    const answer = parseAssistantAnswer('```json\n{"speak":"Done.","display":"Detail."}\n```')

    expect(answer).toEqual({ speak: 'Done.', display: 'Detail.' })
  })

  it('accepts JSON embedded in surrounding prose', () => {
    const answer = parseAssistantAnswer('Here you go: {"speak":"Done.","display":"Detail."} — hope that helps')

    expect(answer).toEqual({ speak: 'Done.', display: 'Detail.' })
  })

  it('falls back to the raw text: capped for speaking, full for display', () => {
    const answer = parseAssistantAnswer('Could not find it. The page had no results. Extra detail here.')

    expect(answer).toEqual({
      speak: 'Could not find it. The page had no results.',
      display: 'Could not find it. The page had no results. Extra detail here.',
    })
  })

  it('ignores JSON whose fields are not both strings', () => {
    const answer = parseAssistantAnswer('{"speak":"Done.","display":42} Not quite valid.')

    expect(answer.display).toBe('{"speak":"Done.","display":42} Not quite valid.')
  })
})

describe('partialAnswerText', () => {
  it('shows nothing while the JSON preamble has not reached a value', () => {
    expect(partialAnswerText('')).toBe('')
    expect(partialAnswerText('{"speak"')).toBe('')
    expect(partialAnswerText('{"speak":')).toBe('')
    expect(partialAnswerText('{"run_note":"hidden","display"')).toBe('')
  })

  it('streams the first key that opens — display or speak — and freezes it once closed', () => {
    expect(partialAnswerText('{"display":"# Det')).toBe('# Det')
    expect(partialAnswerText('{"display":"# Detail\\nwith markdown"}')).toBe('# Detail\nwith markdown')
    // speak came first in this buffer, so it owns the stream; a later
    // display key never shrinks the visible text (the final display entry
    // replaces the partial at round end).
    expect(partialAnswerText('{"speak":"Done.","display":"Full.')).toBe('Done.')
  })

  it('passes prose straight through — the fallback contract streams raw', () => {
    expect(partialAnswerText('Plain reply, no JS')).toBe('Plain reply, no JS')
    expect(partialAnswerText('Here you go: {"speak')).toBe('Here you go: {"speak')
  })

  it('is monotonic as the buffer grows', () => {
    const steps = ['{"display":"Open', '{"display":"Opening YouTu', '{"display":"Opening YouTube.\\nDone."}']
    let previous = ''
    for (const step of steps) {
      const visible = partialAnswerText(step)
      expect(visible.startsWith(previous)).toBe(true)
      previous = visible
    }
    expect(previous).toBe('Opening YouTube.\nDone.')
  })
})

describe('spokenErrorLine', () => {
  it('prefixes the first sentence of the error', () => {
    expect(spokenErrorLine('timed out loading https://youtube.com. gave up after 30s')).toBe(
      'Something went wrong: timed out loading https://youtube.com.',
    )
  })

  it('speaks a plain line when the message is empty', () => {
    expect(spokenErrorLine('')).toBe('Something went wrong.')
  })

  it('keeps the spoken line short for config errors while the dashboard gets the detail', () => {
    const message =
      "model routing for 'orchestrator' is not configured. Set BINGBONG_ORCHESTRATOR_BASE_URL, BINGBONG_ORCHESTRATOR_MODEL, BINGBONG_ORCHESTRATOR_API_KEY, BINGBONG_ORCHESTRATOR_API_KEY_ENV or ZAI_API_KEY."

    expect(spokenErrorLine(message)).toBe("Something went wrong: model routing for 'orchestrator' is not configured.")
  })
})
