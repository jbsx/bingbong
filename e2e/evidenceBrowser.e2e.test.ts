import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// The Evidence Browser's first tracer (#139): a Run's accepted Observation
// checkpoint is visible as `Evidence N` in the Feed Panel header, opens as
// a card in the Evidence view read from the authoritative Session snapshot,
// and survives renderer recovery within the Session. Rejected checkpoints
// never show, exact duplicates never double a card, switching views moves
// no browser or Run state, and the notification path crosses the real
// main/preload/renderer boundary — scripted orchestrator, real CDP
// browser, real Electron IPC.

/** The `Evidence N` control's badge text, or null when no badge shows. */
const EVIDENCE_BADGE = `document.querySelector('.feed-tab--evidence .feed-tab-count')?.textContent ?? null`

/** One Evidence card's statement per card, in document order. */
const EVIDENCE_CARD_TEXTS = `[...document.querySelectorAll('.evidence-card .evidence-text')].map((el) => el.textContent)`

function checkpointRun(page: string, observation: string, answer: string): AssistantTurn[] {
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
    { kind: 'answer', speak: 'Done here.', display: answer },
  ]
}

/** Everything Recorded History holds, one line per entry. */
function recordedHistoryText(app: Harness): Promise<string> {
  return app.dashboardEval<string>(
    `(async () => (await window.bingbong.history.recentEntries()).map((entry) => entry.text).join('\\n'))()`,
  )
}

describe('evidence browser e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('shows accepted Observations, never rejected or duplicated ones; the view switch moves no state', async () => {
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
          // Rejected: this run never observed the URL — unknown source.
          {
            id: 'e2',
            name: 'record_evidence',
            args: {
              observation: 'A page this run never opened.',
              source_url: fixture.url('/never-opened'),
              excerpt: 'anything at all',
            },
          },
          // Exact duplicate of e1: merged into the same Observation.
          {
            id: 'e3',
            name: 'record_evidence',
            args: {
              observation: 'The second fixture page carries the heading.',
              source_url: page,
              excerpt: 'second fixture page',
            },
          },
        ],
      },
      { kind: 'answer', speak: 'Done here.', display: 'Checkpointed the heading.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()

      // No Session, no evidence: the control reads plain `Evidence` — the
      // numeric badge is hidden at zero (observed in Activity, where the
      // control lives).
      expect(
        await app.overlayEval<string>(`document.querySelector('.feed-tab--evidence')?.textContent ?? ''`),
      ).toBe('Evidence')
      expect(await app.overlayEval<string | null>(EVIDENCE_BADGE)).toBeNull()

      // The empty view explains that nothing has been checkpointed.
      await app.clickOverlayElement('.feed-tab--evidence')
      expect(await app.overlayEval<string>(`document.querySelector('.feed-empty')?.textContent ?? ''`)).toContain(
        'Nothing has been checkpointed',
      )

      // Back to Activity, then run the command with the panel watching —
      // the header control must expose the live evidence count.
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')
      const submitted = await app.submitCommand('note what the second page says')
      expect(submitted).toBe('submitted')

      // The run finishes (Recorded History is UI-independent; the done
      // boundary collapses the open panel as ever).
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Checkpointed the heading.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      // `Evidence 1`: one accepted Observation — the duplicate merged, the
      // rejected checkpoint invisible. Both Session-bearing renderers read
      // the same authoritative snapshot (the slot mirrors the dashboard's).
      await waitFor(
        async () => ((await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '1' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(
        await app.dashboardEval<string | null>(`document.querySelector('.feed-slot')?.dataset.evidenceCount ?? null`),
      ).toBe('1')

      // Opening Evidence shows exactly that Observation, from the snapshot.
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      const cards = await waitFor(
        async () => {
          const texts = await app.overlayEval<string[]>(EVIDENCE_CARD_TEXTS)
          return texts.length === 1 && texts[0]!.includes('The second fixture page carries the heading.')
            ? texts
            : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(cards.join('\n')).not.toContain('A page this run never opened')

      // The view switch is renderer-local: the pane never navigated and
      // the activity record stands untouched behind it.
      expect(await app.paneUrl()).toBe(page)
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')
      expect(await app.overlayEval<string>(`document.querySelector('.feed')?.getAttribute('aria-label') ?? ''`)).toBe(
        'activity feed',
      )
      expect(await app.paneUrl()).toBe(page)
    } finally {
      await app.quit()
    }
  })

  it('a recovered panel restores the Session snapshot, then live checkpoints keep it current', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      ...checkpointRun(page, 'First: the heading is on the second page.', 'First checkpointed.'),
      ...checkpointRun(page, 'Second: the heading is still on the second page.', 'Second checkpointed.'),
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      // Run one: one Observation lands in the Session.
      const first = await app.submitCommand('first look at the second page')
      expect(first).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('First checkpointed.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      await waitFor(
        async () => ((await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '1' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // The panel's renderer dies mid-Session — the exact loss main
      // reloads from (ADR 0017). The recovered page pulls the current
      // Session's snapshot again: `Evidence 1` before anything new runs.
      await app.crashRenderer('overlay')
      await waitFor(
        async () => {
          await app.ensurePanelOpen()
          return (await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '1' ? true : undefined
        },
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      await app.clickOverlayElement('.feed-tab--evidence')
      const restored = await waitFor(
        async () => {
          const texts = await app.overlayEval<string[]>(EVIDENCE_CARD_TEXTS)
          return texts.length === 1 && texts[0]!.includes('First: the heading is on the second page.') ? texts : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(restored).toHaveLength(1)

      // The same Session accepts a second Run. Its accepted checkpoint
      // notifies the recovered panel as well, and the count climbs.
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')
      const second = await app.submitCommand('look once more')
      expect(second).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Second checkpointed.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      await app.ensurePanelOpen()
      await waitFor(
        async () => ((await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '2' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // Newest first: the second Run's Observation above the first.
      await app.clickOverlayElement('.feed-tab--evidence')
      const cards = await waitFor(
        async () => {
          const texts = await app.overlayEval<string[]>(EVIDENCE_CARD_TEXTS)
          return texts.length === 2 ? texts : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(cards[0]).toContain('Second: the heading is still on the second page.')
      expect(cards[1]).toContain('First: the heading is on the second page.')

      // The Session's evidence outlived both Runs (ADR 0028) and the pane
      // never moved for any of it.
      expect(await app.paneUrl()).toBe(page)
    } finally {
      await app.quit()
    }
  })
})
