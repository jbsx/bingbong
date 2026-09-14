import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { answerRetryMessage, capSentences, parseAssistantAnswer, partialAnswerText, spokenErrorLine } from './answerContract'

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

    expect(answer).toEqual({ speak: 'One. Two.', display: '# Full detail\nwith markdown', shape: 'on_contract' })
  })

  it('extracts a hidden Run Note without changing the visible Answer', () => {
    const answer = parseAssistantAnswer(
      '{"speak":"Done.","display":"Useful detail.","run_note":"  Ruled out option A; option B remains.  "}',
    )

    expect(answer).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      runNote: 'Ruled out option A; option B remains.',
      shape: 'on_contract',
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
      shape: 'on_contract',
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
      shape: 'on_contract',
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
      shape: 'on_contract',
    })
    expect(parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      mishear_proposals: [],
    }))).toEqual({ speak: 'Done.', display: 'Useful detail.', mishearProposals: [], shape: 'on_contract' })
  })

  it.each([null, 42, '', ' '.repeat(2), 'x'.repeat(1_201)])(
    'preserves a valid Answer while marking malformed Run Note %j',
    (runNote) => {
      const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', run_note: runNote }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', runNoteIssue: 'malformed', shape: 'on_contract' })
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
        shape: 'on_contract',
      })
    },
  )

  it.each([null, 42, 'finished', 'needs user'] as const)(
    'drops a malformed %j Run Resolution while keeping the Answer (#110)',
    (resolution) => {
      const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', resolution }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', resolutionIssue: 'malformed', shape: 'on_contract' })
    },
  )

  it.each([null, 42, 'objective met', 'gave up'] as const)(
    'drops a malformed %j Finalization Cause while keeping the Answer (#110)',
    (cause) => {
      const answer = parseAssistantAnswer(
        JSON.stringify({ speak: 'Done.', display: 'Useful detail.', resolution: 'partial', finalization_cause: cause }),
      )

      expect(answer).toEqual({
        speak: 'Done.',
        display: 'Useful detail.',
        resolution: 'partial',
        finalizationCauseIssue: 'malformed',
        shape: 'on_contract',
      })
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
      shape: 'on_contract',
    })
  })

  it('accepts the supporting Session Evidence identities, deduplicated in order (#122)', () => {
    const answer = parseAssistantAnswer(JSON.stringify({
      speak: 'Done.',
      display: 'Useful detail.',
      evidence_ids: ['memory-2', 'memory-1', 'memory-2'],
    }))

    expect(answer).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      evidenceIds: ['memory-2', 'memory-1'],
      shape: 'on_contract',
    })
    expect(parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', evidence_ids: [] }))).toEqual({
      speak: 'Done.',
      display: 'Useful detail.',
      evidenceIds: [],
      shape: 'on_contract',
    })
  })

  it.each([null, 42, 'memory-1', ['memory-1', 9], ['memory-1', '  '], Array.from({ length: 11 }, (_, i) => `memory-${i}`)])(
    'drops malformed evidence_ids %j while keeping the Answer (#122)',
    (evidenceIds) => {
      const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Done.', display: 'Useful detail.', evidence_ids: evidenceIds }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', evidenceIssue: 'malformed', shape: 'on_contract' })
    },
  )

  it('reads the Asked Item standings, trimmed, in the Answer’s order (#250)', () => {
    const answer = parseAssistantAnswer(JSON.stringify({
      speak: 'Yes.',
      display: 'The guitar can travel.',
      asked_items: [
        { item: ' the guitar ', standing: 'stated', statement: 'It counts as one of two pieces.' },
        { item: 'the fare', standing: 'unverified', statement: 'The fare page did not load.' },
        { item: 'moot', standing: 'stated' },
      ],
    }))

    expect(answer).toEqual({
      speak: 'Yes.',
      display: 'The guitar can travel.',
      askedItems: [
        { item: 'the guitar', standing: 'stated', statement: 'It counts as one of two pieces.' },
        { item: 'the fare', standing: 'unverified', statement: 'The fare page did not load.' },
        { item: 'moot', standing: 'stated', statement: '' },
      ],
      shape: 'on_contract',
    })
  })

  it.each([
    null,
    'the guitar',
    [{ item: 'the guitar', standing: 'verified', statement: 'x' }],
    [{ standing: 'stated', statement: 'x' }],
    [{ item: '', standing: 'stated' }],
    [{ item: 'the guitar', standing: 'stated', statement: 42 }],
    ['the guitar'],
  ])('drops a malformed asked_items %j while keeping the Answer (#250)', (askedItems) => {
    const answer = parseAssistantAnswer(JSON.stringify({ speak: 'Yes.', display: 'The guitar can travel.', asked_items: askedItems }))

    expect(answer).toEqual({ speak: 'Yes.', display: 'The guitar can travel.', askedItemsIssue: 'malformed', shape: 'on_contract' })
  })

  it('accepts the one Candidate an Answer presents for inspection (#210)', () => {
    const answer = parseAssistantAnswer(JSON.stringify({
      speak: 'Here it is.',
      display: 'The r/tierlists post.',
      inspection_candidate_id: 'memory-4',
    }))

    expect(answer).toEqual({
      speak: 'Here it is.',
      display: 'The r/tierlists post.',
      inspectionCandidateId: 'memory-4',
      shape: 'on_contract',
    })
  })

  // #210, ADR 0039: an inspection subject is one Candidate or none. A
  // list of them is the ambiguity that has to be clarified with the user,
  // so it never becomes a reference — and the Answer still stands.
  it.each([null, 42, '', '   ', ['memory-4'], ['memory-4', 'memory-5'], { id: 'memory-4' }])(
    'drops a malformed inspection_candidate_id %j while keeping the Answer (#210)',
    (inspectionCandidateId) => {
      const answer = parseAssistantAnswer(JSON.stringify({
        speak: 'Done.',
        display: 'Useful detail.',
        inspection_candidate_id: inspectionCandidateId,
      }))

      expect(answer).toEqual({ speak: 'Done.', display: 'Useful detail.', inspectionIssue: 'malformed', shape: 'on_contract' })
    },
  )

  it('accepts JSON wrapped in a code fence', () => {
    const answer = parseAssistantAnswer('```json\n{"speak":"Done.","display":"Detail."}\n```')

    expect(answer).toEqual({ speak: 'Done.', display: 'Detail.', shape: 'on_contract' })
  })

  it('accepts JSON embedded in surrounding prose', () => {
    const answer = parseAssistantAnswer('Here you go: {"speak":"Done.","display":"Detail."} — hope that helps')

    expect(answer).toEqual({ speak: 'Done.', display: 'Detail.', shape: 'on_contract' })
  })

  it('falls back to the raw text: capped for speaking, full for display', () => {
    const answer = parseAssistantAnswer('Could not find it. The page had no results. Extra detail here.')

    expect(answer).toEqual({
      speak: 'Could not find it. The page had no results.',
      display: 'Could not find it. The page had no results. Extra detail here.',
      shape: 'off_contract',
    })
  })

  it('marks the reply’s shape: the JSON branch is on contract, everything else is off (#198)', () => {
    // The marker is what the two reserved rounds read — the boundary is
    // exactly what the JSON branch accepts, with no finer cut between "no
    // JSON found" and "JSON of the wrong shape". An ordinary round renders
    // an off-contract reply as the Answer either way, which is why the
    // prose fallback below still carries speak and display.
    expect(parseAssistantAnswer('{"speak":"Done.","display":"Detail."}').shape).toBe('on_contract')
    expect(parseAssistantAnswer('```json\n{"speak":"Done.","display":"Detail."}\n```').shape).toBe('on_contract')
    expect(parseAssistantAnswer('Here you go: {"speak":"Done.","display":"Detail."}').shape).toBe('on_contract')
    // Prose, and JSON that carries none of the contract's keys.
    expect(parseAssistantAnswer('Retrying with the observation id.').shape).toBe('off_contract')
    expect(parseAssistantAnswer('{"answer":"Done."}').shape).toBe('off_contract')
    expect(parseAssistantAnswer('').shape).toBe('off_contract')
    // The contract's keys without its shape is the third shape (#245).
    expect(parseAssistantAnswer('{"speak":"Done.","display":42}').shape).toBe('malformed')
  })

  describe('a Malformed Answer (#245)', () => {
    const EUROSTAR_ROUND_7 = readFileSync(fileURLToPath(new URL('./fixtures/eurostar-round-7-reply.txt', import.meta.url)), 'utf8')

    it('marks the recorded Eurostar reply malformed, with the parser’s own message and position', () => {
      // baseline-1's round 7: prose, then the Answer object wrapped in
      // `**…**` whose "display" over-escaped its inner quotes.
      const answer = parseAssistantAnswer(EUROSTAR_ROUND_7)

      expect(answer.shape).toBe('malformed')
      expect(answer.malformedError).toMatch(/^Expected ',' or '}' after property value in JSON at position 909/)
      // Rendered exactly as today when nothing retries it: no repair.
      expect(answer.display).toBe(EUROSTAR_ROUND_7.trim())
      expect(answer).not.toHaveProperty('finalizationCause')
      expect(answer).not.toHaveProperty('resolution')
    })

    it('names the field and what it was for JSON of the wrong shape', () => {
      expect(parseAssistantAnswer('{"speak":"Done.","display":42}')).toMatchObject({
        shape: 'malformed',
        malformedError: '"display" is not a string',
      })
      expect(parseAssistantAnswer('{"speak":["Done."],"display":"Detail."}')).toMatchObject({
        shape: 'malformed',
        malformedError: '"speak" is not a string',
      })
      expect(parseAssistantAnswer('{"answer":{"speak":"Done.","display":"Detail."}}')).toMatchObject({
        shape: 'malformed',
        malformedError: '"speak" is missing',
      })
    })

    it('reads the candidate slice past a prose lead-in, the way the parser tried it', () => {
      // The whole text fails at its first letter; the slice is what the
      // parser meant, so its failure is the one named.
      expect(parseAssistantAnswer('Here it is: {"speak":"Done.","display":42}')).toMatchObject({
        shape: 'malformed',
        malformedError: '"display" is not a string',
      })
    })

    it('needs both keys: prose that mentions one is still a prose Answer', () => {
      expect(parseAssistantAnswer('The "display" setting is under Appearance.').shape).toBe('off_contract')
      expect(parseAssistantAnswer('{"speak":"Done."}').shape).toBe('off_contract')
      expect(parseAssistantAnswer('Retrying with the observation id.')).not.toHaveProperty('malformedError')
    })

    it('words the Answer Retry message as decision 4 pins it, carrying the failure verbatim', () => {
      const { malformedError } = parseAssistantAnswer(EUROSTAR_ROUND_7)

      expect(answerRetryMessage(malformedError ?? '')).toBe(
        `Your last reply was meant as the Answer but could not be read as one: ${malformedError}. ` +
          'Reply with only the JSON object: no text before or after it, no code fences, "speak" and "display" as strings.',
      )
      expect(answerRetryMessage('"display" is not a string')).toBe(
        'Your last reply was meant as the Answer but could not be read as one: "display" is not a string. ' +
          'Reply with only the JSON object: no text before or after it, no code fences, "speak" and "display" as strings.',
      )
    })

    it('never marks an on-contract reply', () => {
      expect(parseAssistantAnswer('{"speak":"Done.","display":"Detail."}')).not.toHaveProperty('malformedError')
    })
  })

  it('still reads an ordinary round’s prose reply as an Answer (#198)', () => {
    // Outside a reserved round nothing changes: a model that answers a
    // simple question in prose is answering, and the fallback contract
    // still carries the spoken line and the displayed text.
    const answer = parseAssistantAnswer('The router costs $39. It ships free over $25. Stock is low.')

    expect(answer).toEqual({
      speak: 'The router costs $39. It ships free over $25.',
      display: 'The router costs $39. It ships free over $25. Stock is low.',
      shape: 'off_contract',
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
