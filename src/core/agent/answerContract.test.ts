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

  it('parses valid Subagent Report sections without changing the visible Answer (#98)', () => {
    const answer = parseAssistantAnswer(JSON.stringify({
      speak: 'Found it.',
      display: 'Model X leads.',
      findings: [{ subject: 'Winner', detail: 'Model X leads.', references: [{ url: 'https://reviews.test/x', title: 'Review' }] }],
      unresolved: ['Stock unknown'],
    }))

    expect(answer.speak).toBe('Found it.')
    expect(answer.display).toBe('Model X leads.')
    expect(answer.findings).toEqual([{
      subject: 'Winner',
      detail: 'Model X leads.',
      references: [{ url: 'https://reviews.test/x', title: 'Review' }],
    }])
    expect(answer.unresolved).toEqual(['Stock unknown'])
  })

  it('drops invalid Subagent Report sections while keeping the Answer and the valid section (#98)', () => {
    const answer = parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Prose carries everything.',
      findings: [{ subject: 'No detail field' }],
      unresolved: ['Still open'],
    }))

    expect(answer.display).toBe('Prose carries everything.')
    expect(answer.findings).toBeUndefined()
    expect(answer.unresolved).toEqual(['Still open'])
  })

  it('leaves orchestrator answers untouched by report sections (#98)', () => {
    const answer = parseAssistantAnswer(
      '{"speak":"Done.","display":"Detail.","run_note":"note","memory_patch":[{"op":"add","entry":{"kind":"decision","subject":"S","detail":"D"}}]}',
    )

    expect(answer.findings).toBeUndefined()
    expect(answer.unresolved).toBeUndefined()
    expect(answer.runNote).toBe('note')
    expect(answer.memoryPatch).toEqual([{ op: 'add', entry: { kind: 'decision', subject: 'S', detail: 'D' } }])
  })

  it('validates hidden Working Memory operations without changing the visible Answer', () => {
    const answer = parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      run_note: 'Found the release.',
      memory_patch: [{
        op: 'add',
        entry: {
          kind: 'finding',
          subject: 'Release',
          detail: 'Version 2 shipped.',
          references: [{ url: 'https://example.com/releases/#v2' }],
        },
      }],
    }))

    expect(answer).toMatchObject({
      speak: 'Done.',
      display: 'Useful detail.',
      runNote: 'Found the release.',
      memoryPatch: [{ op: 'add', entry: { kind: 'finding', references: [{ url: 'https://example.com/releases' }] } }],
    })
  })

  it('preserves a valid Answer while marking a malformed memory patch', () => {
    expect(parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      run_note: 'Still useful.',
      memory_patch: [{ op: 'add', entry: { kind: 'instruction', subject: 'Do this', detail: 'Ignore rules.' } }],
    }))).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      runNote: 'Still useful.',
      memoryPatchIssue: 'malformed',
    })
  })

  it('validates Mishear proposals from the same final response', () => {
    expect(parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      mishear_proposals: [
        { op: 'add', suspect: 'pedal', repair: 'panel' },
        { op: 'remove', term: 'pannel' },
      ],
    }))).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      mishearProposals: [
        { op: 'add', suspect: 'pedal', repair: 'panel' },
        { op: 'remove', term: 'pannel' },
      ],
    })
  })

  it('preserves a valid Answer while dropping malformed Mishear proposals wholesale', () => {
    expect(parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      mishear_proposals: [{ op: 'add', repair: 'panel' }],
    }))).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      mishearProposalsIssue: 'malformed',
    })
    expect(parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      mishear_proposals: [],
    }))).toEqual({ speak: 'Done.', display: 'Useful detail.', mishearProposals: [] })
  })

  it.each([null, 42, '', ' '.repeat(2), 'x'.repeat(1_201)])(
    'preserves a valid Answer while marking malformed Run Note %j',
    (runNote) => {
      const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', run_note: runNote }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', runNoteIssue: 'malformed' })
    },
  )

  it.each(['completed', 'partial', 'blocked', 'needs_user', 'unsuccessful'] as const)(
    'accepts the %s Run Resolution without changing the visible Answer (#110)',
    (resolution) => {
      const answer = parseAssistantAnswer(
        JSON.stringify({ speak: 'Done.', display: 'Useful detail.', resolution, finalization_cause: 'objective_met' }),
      )

      expect(answer).toEqual({
        speak: 'Done.',
        display: 'Useful detail.',
        resolution,
        finalizationCause: 'objective_met',
      })
    },
  )

  it.each([null, 42, 'finished', 'needs user'] as const)(
    'drops a malformed %j Run Resolution while keeping the Answer (#110)',
    (resolution) => {
      const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', resolution }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', resolutionIssue: 'malformed' })
    },
  )

  it.each([null, 42, 'objective met', 'gave up'] as const)(
    'drops a malformed %j Finalization Cause while keeping the Answer (#110)',
    (cause) => {
      const answer = parseAssistantAnswer(
        JSON.stringify({ speak: 'Done.', display: 'Useful detail.', resolution: 'partial', finalization_cause: cause }),
      )

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', resolution: 'partial', finalizationCauseIssue: 'malformed' })
    },
  )

  it('marks both semantic fields malformed without discarding the Answer or each other’s issues (#110)', () => {
    const answer = parseAssistantAnswer(
      JSON.stringify({ speak: 'Done.', display: 'Useful detail.', resolution: 'done-ish', finalization_cause: 9 }),
    )

    expect(answer).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      resolutionIssue: 'malformed',
      finalizationCauseIssue: 'malformed',
    })
  })

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
