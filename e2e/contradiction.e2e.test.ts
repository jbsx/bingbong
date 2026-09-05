import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { MemoryEntryId } from '../src/core/session/workingMemory'

// Contradictions made durable and visible (#143, ADR 0028): the
// mechanical relationship — same source kind, a shared canonical source
// URL, a different statement — is retained in the authoritative Session
// Evidence snapshot, not just disclosed on a checkpoint result. A later
// Run's contradictory Observation groups beside the earlier one in the
// Evidence Browser (neither silently preferred), and every earlier
// Answer standing on the contradicted Observation gains a warning on
// its Evidence Summary — recomputed from the live snapshot, never by
// rewriting the Answer's own text. Real main/preload/renderer boundary,
// scripted orchestrator, real CDP browser, real Electron IPC.

/** The `Evidence N` control's badge text, or null when no badge shows. */
const EVIDENCE_BADGE = `document.querySelector('.feed-tab--evidence .feed-tab-count')?.textContent ?? null`

/** The Answer Evidence Summaries in feed order, as [chip, open] pairs. */
const SUMMARY_WARNING_CHIPS =
  `[...document.querySelectorAll('.feed-entry--display details.answer-evidence')].map((el) => el.querySelector('.answer-evidence-warning-chip')?.textContent ?? null)`

function observationRun(page: string, observation: string): AssistantTurn[] {
  return [
    {
      kind: 'tool_calls',
      calls: [
        { id: 'n1', name: 'navigate', args: { url: page } },
        {
          id: 'e1',
          name: 'record_evidence',
          args: { observation, source_url: page, excerpt: 'second fixture page' },
        },
      ],
    },
  ]
}

describe('contradiction e2e (#143)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('a later Run warns an earlier Answer while preserving both Observations and the original Answer', async () => {
    const page = fixture.url('/second')
    // A fresh app's first Session mints evidence deterministically:
    // memory-1 the earlier statement, memory-2 the later contradictory
    // one from the same source. The first Answer stands on memory-1;
    // the second cites only memory-2 — the newer statement — so its own
    // summary stays unwarned.
    const script: AssistantTurn[] = [
      ...observationRun(page, 'Web fact: the second page says the widget costs $39.'),
      { kind: 'answer', speak: 'Thirty-nine.', display: 'The widget costs $39.', evidenceIds: ['memory-1' as MemoryEntryId] },
      ...observationRun(page, 'Web fact: the second page says the widget costs $59.'),
      { kind: 'answer', speak: 'Fifty-nine.', display: 'The widget now costs $59.', evidenceIds: ['memory-2' as MemoryEntryId] },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      // Run one: the earlier Answer lands, its summary uncontradicted.
      const first = await app.submitCommand('what does the second page say the widget costs')
      expect(first).toBe('submitted')
      await waitFor(
        async () => ((app.runTraceTranscript().includes('The widget costs $39.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      await app.ensurePanelOpen()
      await waitFor(
        async () => {
          const chips = await app.overlayEval<(string | null)[]>(SUMMARY_WARNING_CHIPS)
          return chips.length === 1 && chips[0] === null ? chips : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // Run two, same Session: the same source now says something else.
      const second = await app.submitCommand('check the price again')
      expect(second).toBe('submitted')
      await waitFor(
        async () => ((app.runTraceTranscript().includes('The widget now costs $59.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      // Both Observations survive — the disagreement is disclosed
      // Session state, never an overwrite.
      await app.ensurePanelOpen()
      await waitFor(
        async () => ((await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '2' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // The Evidence Browser groups the contradictory Observations side
      // by side: one visible group holding both statements, both cards
      // flagged, neither preferred.
      await app.clickOverlayElement('.feed-tab--evidence')
      const group = await waitFor(
        async () => {
          const groupText = await app.overlayEval<string>(
            `document.querySelector('.evidence-contradiction')?.textContent ?? ''`,
          )
          return groupText.includes('widget costs $39.') && groupText.includes('widget costs $59.') ? groupText : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(group).toContain('contradictory observations')
      expect(
        await app.overlayEval<number>(`document.querySelectorAll('.evidence-contradiction').length`),
      ).toBe(1)
      expect(
        await app.overlayEval<number>(`document.querySelectorAll('.evidence-contradiction .evidence-card').length`),
      ).toBe(2)
      expect(
        await app.overlayEval<number>(
          `document.querySelectorAll('.evidence-contradiction .evidence-card[data-contradicted="true"]').length`,
        ),
      ).toBe(2)
      // The Observation section's honest count: both cards, one group.
      expect(
        await app.overlayEval<string>(
          `document.querySelector('.evidence-section[aria-label="observations"] .evidence-section-count')?.textContent ?? ''`,
        ),
      ).toBe('2/2')
      // Newest first inside the group: the later statement leads.
      expect(
        await app.overlayEval<string[]>(
          `[...document.querySelectorAll('.evidence-contradiction .evidence-text')].map((el) => el.textContent)`,
        ),
      ).toEqual(['Web fact: the second page says the widget costs $59.', 'Web fact: the second page says the widget costs $39.'])

      // Back on Activity: the earlier Answer's summary — collapsed,
      // already rendered before the contradiction existed — now carries
      // the warning, while the later Answer's summary stays clean.
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')
      const chips = await waitFor(
        async () => {
          const chips = await app.overlayEval<(string | null)[]>(SUMMARY_WARNING_CHIPS)
          return chips.length === 2 && chips[0] === 'contradicted' && chips[1] === null ? chips : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(chips).toEqual(['contradicted', null])

      // The original Answer text is byte-for-byte unchanged: the
      // warning rides its Evidence Summary, never the Answer itself.
      expect(
        await app.overlayEval<string>(
          `[...document.querySelectorAll('.feed-entry--display .feed-text--markdown')].at(0)?.textContent ?? ''`,
        ),
      ).toBe('The widget costs $39.')

      // Expanding the warned summary explains the disagreement and
      // flags the cited Observation's card — the record of what was
      // observed stays intact and inspectable.
      await app.overlayEval(
        `[...document.querySelectorAll('.feed-entry--display details.answer-evidence')].at(0)?.querySelector('.answer-evidence-summary')?.scrollIntoView({ block: 'center' })`,
      )
      await app.clickOverlayElement('.feed-entry--display details.answer-evidence .answer-evidence-summary')
      const warned = await waitFor(
        async () => {
          const note = await app.overlayEval<string>(
            `[...document.querySelectorAll('.feed-entry--display details.answer-evidence')].at(0)?.querySelector('.answer-evidence-warning')?.textContent ?? ''`,
          )
          return note.includes('contradicts') && note.includes('unchanged') ? note : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(warned).toContain('same source')
      expect(
        await app.overlayEval<number>(
          `[...document.querySelectorAll('.feed-entry--display details.answer-evidence')].at(0)?.querySelectorAll('.evidence-chip--contradicted').length ?? 0`,
        ),
      ).toBe(1)
      expect(
        await app.overlayEval<string>(
          `[...document.querySelectorAll('.feed-entry--display details.answer-evidence')].at(0)?.querySelector('.evidence-text')?.textContent ?? ''`,
        ),
      ).toBe('Web fact: the second page says the widget costs $39.')

      // Inspecting the disagreement moved no browser state.
      expect(await app.paneUrl()).toBe(page)
    } finally {
      await app.quit()
    }
  })
})
