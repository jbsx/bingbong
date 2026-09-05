import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { tracedEvents } from './runTrace'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { MemoryEntryId } from '../src/core/session/workingMemory'

// The Answer Evidence Summary (#141): a final Answer's already-declared
// evidence identities attach to its Feed entry as Session-only metadata
// and resolve, live, into a collapsed summary of exactly those
// Observations — no second model round decides relevance. The generated
// Markdown Sources list is gone from the live Feed (the summary replaces
// it; the model's own links stay put). Nothing durable renders it: with
// Recorded History retired (#188) the Answer survives only in the Run
// Trace, which — being opt-in diagnostics on the developer's own machine
// — keeps the event exactly as published, derived sources and declared
// identities included. Real main/preload/renderer boundary, scripted
// orchestrator, real CDP browser, real Electron IPC.

describe('answer evidence summary e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('attaches the declared Observations as a collapsed summary — no second round, no duplicate sources, and the Run Trace keeps the Answer verbatim', async () => {
    const page = fixture.url('/second')
    const linked = fixture.url('/cookie-echo')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'n1', name: 'navigate', args: { url: page } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'The second fixture page carries the heading.',
              source_url: page,
              excerpt: 'second fixture page',
            },
          },
        ],
      },
      // Exactly the two turns the run consumes: the work round and the
      // reserved Answer round. Any relevance round for the summary would
      // exhaust the script and fail the run before an answer rendered —
      // a completing answer is the no-second-round proof.
      {
        kind: 'answer',
        speak: 'The heading is noted.',
        display: `The second page carries the heading. Its [twin](${linked}) is plainer.`,
        evidenceIds: ['memory-1' as MemoryEntryId],
      },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()
      const submitted = await app.submitCommand('note what the second page says')
      expect(submitted).toBe('submitted')

      // The run completed — the scripted answer reached the Run Trace
      // (and with it every live surface: the same event feeds both).
      await waitFor(
        async () => ((app.runTraceTranscript().includes('The second page carries the heading.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      // The Answer card (#56): the model's own wording with its ordinary
      // Markdown link intact — and no generated Sources block duplicating
      // the structured summary beside it.
      await app.ensurePanelOpen()
      const cardText = await waitFor(
        async () => {
          const text = await app.overlayEval<string>(
            `document.querySelector('.feed-entry--display .feed-text--markdown')?.textContent ?? ''`,
          )
          return text.includes('The second page carries the heading.') ? text : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(cardText).toBe('The second page carries the heading. Its twin is plainer.')
      expect(cardText).not.toContain('Sources:')
      expect(
        await app.overlayEval<string>(
          `document.querySelector('.feed-entry--display .feed-text--markdown a[href="${linked}"]')?.textContent ?? ''`,
        ),
      ).toBe('twin')

      // The collapsed Answer Evidence Summary: present, closed by
      // default, counting exactly the one declared Observation.
      await waitFor(
        async () => {
          const open = await app.overlayEval<boolean | null>(
            `(() => { const el = document.querySelector('.feed-entry--display details.answer-evidence'); return el ? el.open : null })()`,
          )
          return open === false ? true : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(
        await app.overlayEval<string>(`document.querySelector('.feed-entry--display .answer-evidence-count')?.textContent ?? ''`),
      ).toBe('1')

      // Expanding it shows exactly the declared Observation, resolved
      // from the authoritative snapshot — source kind, statement, and the
      // retained source URL as plain selectable text (the copy control
      // is #144's), never a link that could navigate the pane.
      await app.clickOverlayElement('.feed-entry--display .answer-evidence-summary')
      const cited = await waitFor(
        async () => {
          const cards = await app.overlayEval<string[]>(
            `[...document.querySelectorAll('.feed-entry--display details.answer-evidence[open] .evidence-card')].map((el) => el.textContent)`,
          )
          return cards.length === 1 && cards[0]!.includes('The second fixture page carries the heading.') ? cards : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(cited[0]).toContain('web')
      expect(cited[0]).toContain(page)
      expect(
        await app.overlayEval<number>(`document.querySelectorAll('.feed-entry--display details.answer-evidence a').length`),
      ).toBe(0)

      // The Run Trace: the `display` event exactly as it was published —
      // the model's own text with its Markdown link, the derived sources
      // as structured references, and the identities the Answer declared.
      // Recorded History was allowed none of that; an opt-in diagnostic
      // is (ADR 0030), which is why the store was retired rather than
      // widened (#188).
      const answer = await waitFor(
        async () =>
          tracedEvents(app.readRunTrace(), 'display').find((event) =>
            event.text.includes('The second page carries the heading.'),
          ),
        { timeoutMs: 10_000, intervalMs: 250 },
      )
      expect(answer.text).toContain(`[twin](${linked})`)
      expect(answer.sources?.map((source) => source.url)).toEqual([page])
      expect(answer.evidenceIds).toEqual(['memory-1'])

      // Inspecting evidence moved no browser state: the pane stayed on
      // the page the run opened.
      expect(await app.paneUrl()).toBe(page)
    } finally {
      await app.quit()
    }
  })

  it('leaves a later Answer unknown declared identities absent — the summary shows exactly what resolves', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'n1', name: 'navigate', args: { url: page } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'The second fixture page carries the heading.',
              source_url: page,
              excerpt: 'second fixture page',
            },
          },
        ],
      },
      { kind: 'answer', speak: 'First noted.', display: 'First: the heading is on the second page.', evidenceIds: ['memory-1' as MemoryEntryId] },
      // A later Run in the same Session cites one live Observation and
      // one the Session never held: the summary shows exactly the one
      // that resolves — nothing inferred, no extra round spent.
      { kind: 'answer', speak: 'Still the heading.', display: 'Still the heading, per the record.', evidenceIds: ['memory-1' as MemoryEntryId, 'memory-9' as MemoryEntryId] },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      const first = await app.submitCommand('note what the second page says')
      expect(first).toBe('submitted')
      await waitFor(
        async () => ((app.runTraceTranscript().includes('First: the heading is on the second page.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      const second = await app.submitCommand('is it still the heading')
      expect(second).toBe('submitted')
      await waitFor(
        async () => ((app.runTraceTranscript().includes('Still the heading, per the record.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      // The second Answer's summary: the one declared Observation that
      // resolves, and the unknown identity nowhere — not as a card, not
      // as a gap, not as an error.
      await app.ensurePanelOpen()
      const summaries = await waitFor(
        async () => {
          const count = await app.overlayEval<number>(
            `document.querySelectorAll('.feed-entry--display details.answer-evidence').length`,
          )
          return count === 2 ? count : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(summaries).toBe(2)
      // The second Answer declared two identities; exactly one resolves.
      expect(
        await app.overlayEval<string>(
          `[...document.querySelectorAll('.feed-entry--display .answer-evidence-count')].at(-1)?.textContent ?? ''`,
        ),
      ).toBe('1')
      const secondSummary = await app.overlayEval<string>(
        `[...document.querySelectorAll('.feed-entry--display details.answer-evidence')].at(-1)?.textContent ?? ''`,
      )
      expect(secondSummary).toContain('The second fixture page carries the heading.')
      expect(secondSummary).not.toContain('memory-9')
      const overlayText = await app.overlayEval<string>(`document.body.textContent`)
      expect(overlayText).not.toContain('memory-9')
    } finally {
      await app.quit()
    }
  })
})
