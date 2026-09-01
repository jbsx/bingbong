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
//
// The complete browser (#142): mixed Observation kinds (web, user, and a
// delegated worker's web evidence), full Observation cards with
// uncertainty, revalidation need, source labels, and human-readable
// provenance; Candidate creation and a live decision; per-section filters
// that hide cards without touching the filter-independent `Evidence N`
// total; exact-duplicate merging beside live Candidate updates; support
// that focuses the existing Observation card instead of copying it; and
// internal identities (Memory Entry, Run, Observation, Subagent) that
// never surface as visible text.

/** The `Evidence N` control's badge text, or null when no badge shows. */
const EVIDENCE_BADGE = `document.querySelector('.feed-tab--evidence .feed-tab-count')?.textContent ?? null`

/** One Evidence card's statement per card, in document order. */
const EVIDENCE_CARD_TEXTS = `[...document.querySelectorAll('.evidence-card .evidence-text')].map((el) => el.textContent)`

/** The Observation section's cards, newest first. */
const OBSERVATION_CARDS = `[...document.querySelectorAll('.evidence-section[aria-label="observations"] .evidence-card')]`

/** The Observation filter chips in vocabulary order: all, web, vision, action, user, delegated. */
const observationFilter = (filter: 'all' | 'web' | 'user' | 'delegated'): string =>
  `.evidence-section[aria-label="observations"] .evidence-filter:nth-child(${
    { all: 1, web: 2, user: 5, delegated: 6 }[filter]
  })`

/** The Candidate filter chips in vocabulary order: all, active, accepted, rejected, superseded. */
const candidateFilter = (filter: 'all' | 'active' | 'accepted' | 'rejected' | 'superseded'): string =>
  `.evidence-section[aria-label="candidates"] .evidence-filter:nth-child(${
    { all: 1, active: 2, accepted: 3, rejected: 4, superseded: 5 }[filter]
  })`

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

/**
 * Scroll an overlay element into view, then click it: synthetic CDP clicks
 * land on viewport coordinates only, so a card below the fold (the browser
 * scrolls its own list) must be brought up first.
 */
async function clickScrolledOverlayElement(app: Harness, selector: string): Promise<void> {
  await app.overlayEval(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`)
  await app.clickOverlayElement(selector)
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

  it('the complete browser: mixed kinds, Candidate lifecycle, filters, honest counts, merges, and support focus (#142)', async () => {
    const page = fixture.url('/second')
    const COMMAND = 'collect every kind of evidence'
    // A fresh app's first Session mints evidence deterministically:
    // memory-1 web, memory-2 user (the duplicate merges into memory-1),
    // memory-3 the delegated worker's web fact, memory-4 the Candidate.
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          // Delegation needs the investigation tier (#120).
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Collect every evidence kind', headline: 'Collecting evidence', effort_tier: 'investigation' },
          },
          { id: 'n1', name: 'navigate', args: { url: page } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'Web fact: the second page carries the heading.',
              source_url: page,
              excerpt: 'second fixture page',
              uncertainty: 'layout may change',
              volatile: true,
            },
          },
          // Exact duplicate of e1: merges — no second card.
          {
            id: 'e2',
            name: 'record_evidence',
            args: {
              observation: 'Web fact: the second page carries the heading.',
              source_url: page,
              excerpt: 'second fixture page',
            },
          },
          // User kind: this Run's own command, verbatim.
          { id: 'e3', name: 'record_evidence', args: { kind: 'user', observation: COMMAND } },
          { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'look at the second page' } },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          { id: 'r1', name: 'agent_results', args: { wait: true } },
          {
            id: 'e4',
            name: 'record_evidence',
            args: {
              kind: 'subagent',
              agent_id: 'a-1',
              observation: 'Delegated fact: the worker also saw the heading.',
              source_url: page,
            },
          },
          {
            id: 'c1',
            name: 'record_candidate',
            args: { subject: 'The page carries the heading', detail: 'Seen directly and by the worker.', supporting_evidence: ['memory-1'] },
          },
          {
            id: 'c2',
            name: 'record_candidate',
            args: { subject: 'The heading is elsewhere', supporting_evidence: ['memory-2'] },
          },
          {
            id: 'c3',
            name: 'record_candidate',
            args: { subject: 'Ask the user which heading', supporting_evidence: ['memory-2'] },
          },
        ],
      },
      { kind: 'answer', speak: 'Collected.', display: 'Collected every kind.' },
    ]
    const decision: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            id: 'd1',
            name: 'record_candidate',
            args: { candidate_id: 'memory-4', status: 'accepted', supporting_evidence: ['memory-1'] },
          },
          {
            id: 'd2',
            name: 'record_candidate',
            args: { candidate_id: 'memory-5', status: 'rejected', supporting_evidence: ['memory-1'] },
          },
          {
            id: 'd3',
            name: 'record_candidate',
            args: { candidate_id: 'memory-6', status: 'superseded', supporting_evidence: ['memory-1'] },
          },
        ],
      },
      { kind: 'answer', speak: 'Decided.', display: 'Accepted the candidate.' },
    ]
    const worker: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'w1', name: 'navigate', args: { url: page } }] },
      { kind: 'answer', speak: 'done', display: 'Saw the second page.' },
    ]
    const app = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify([...script, ...decision]),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(worker),
      },
    })
    try {
      await app.ensurePanelOpen()
      const submitted = await app.submitCommand(COMMAND)
      expect(submitted).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Collected every kind.')) ? true : undefined),
        { timeoutMs: 30_000, intervalMs: 250 },
      )

      // `Evidence 6`: three Observations (the duplicate merged) plus three
      // Candidates — the total the header and the dashboard slot both carry.
      await waitFor(
        async () => ((await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '6' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(
        await app.dashboardEval<string | null>(`document.querySelector('.feed-slot')?.dataset.evidenceCount ?? null`),
      ).toBe('6')

      // The complete browser: Observation cards newest first — delegated
      // (the worker saw the page after this run's own reads), web, user.
      // The worker's statement and this run's own differ mechanically —
      // same web source, different statements — so #143 groups them as
      // one visible disagreement: both cards flagged, neither preferred,
      // the cluster at the newest member's position.
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      const observationCards = await waitFor(
        async () => {
          const cards = await app.overlayEval<string[]>(`${OBSERVATION_CARDS}.map((el) => el.textContent)`)
          return cards.length === 3 ? cards : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(observationCards[0]).toContain('Delegated fact: the worker also saw the heading.')
      expect(observationCards[1]).toContain('Web fact: the second page carries the heading.')
      expect(observationCards[2]).toContain(COMMAND)
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
      // Full Observation cards (#142): uncertainty, revalidation need, the
      // source label — the title the checkpoint retained from the page
      // state it observed (#144; the title-less fixture carries the
      // browser's URL-shaped display title, which names the host) — and
      // human-readable provenance.
      expect(observationCards[1]).toContain('uncertainty: layout may change')
      expect(observationCards[1]).toContain('needs revalidation')
      expect(observationCards[1]).toContain('127.0.0.1')
      expect(observationCards[0]).toContain('via a delegated subagent')
      expect(observationCards[2]).toContain("the user's command")

      // The delegated card presents delegation without changing its
      // grounding source kind: kind chip stays web, plus the delegated chip.
      const delegatedKinds = await app.overlayEval<string[]>(
        `${OBSERVATION_CARDS}.filter((el) => el.querySelector('.evidence-chip--delegated')).map((el) => el.querySelector('.evidence-kind')?.textContent)`,
      )
      expect(delegatedKinds).toEqual(['web'])

      // Three Candidates, all active, each with a support reference — a
      // reference, not a copy: the cited Observation's statement appears
      // once, in the Observation section alone.
      expect(
        await app.overlayEval<string[]>(
          `[...document.querySelectorAll('.evidence-card--candidate')].map((el) => el.dataset.candidateStatus)`,
        ),
      ).toEqual(['active', 'active', 'active'])
      const candidateCard = await app.overlayEval<string>(
        `document.querySelector('.evidence-card--candidate[data-candidate-id="memory-4"]')?.textContent ?? ''`,
      )
      expect(candidateCard).toContain('The page carries the heading')
      expect(candidateCard).toContain('active')
      expect(await app.overlayEval<number>(`document.querySelectorAll('.evidence-support-ref').length`)).toBe(3)
      expect(await app.overlayEval<number>(`document.querySelectorAll('.evidence-card--candidate[data-candidate-id="memory-4"] .evidence-support-ref').length`)).toBe(1)
      expect(candidateCard).not.toContain('Web fact: the second page carries the heading.')

      // Observation filters hide cards, never evidence: the user filter
      // shows one card while the dashboard's honest total still reads 6.
      await app.clickOverlayElement(observationFilter('user'))
      expect(await app.overlayEval<number>(`document.querySelectorAll('.evidence-section[aria-label="observations"] .evidence-card').length`)).toBe(1)
      expect(
        await app.dashboardEval<string | null>(`document.querySelector('.feed-slot')?.dataset.evidenceCount ?? null`),
      ).toBe('6')

      // The delegated filter shows the worker's evidence; its grounding
      // kind stays web.
      await app.clickOverlayElement(observationFilter('delegated'))
      const delegatedFilterKinds = await app.overlayEval<string[]>(
        `${OBSERVATION_CARDS}.map((el) => el.querySelector('.evidence-kind')?.textContent)`,
      )
      expect(delegatedFilterKinds).toEqual(['web'])

      // The web filter covers every web-grounded Observation — the
      // delegated one included (presentation never rewrites grounding).
      await app.clickOverlayElement(observationFilter('web'))
      expect(await app.overlayEval<number>(`document.querySelectorAll('.evidence-section[aria-label="observations"] .evidence-card').length`)).toBe(2)

      // A Candidate's support references the existing Observation card:
      // with the user filter hiding it, the reference still reaches — the
      // filter widens and the card is focused, its contents never copied.
      await app.clickOverlayElement(observationFilter('user'))
      await clickScrolledOverlayElement(
        app,
        '.evidence-card--candidate[data-candidate-id="memory-4"] .evidence-support-ref',
      )
      await waitFor(
        async () => {
          const focused = await app.overlayEval<boolean>(`!!document.querySelector('.evidence-card--focused')`)
          const visible = await app.overlayEval<number>(`document.querySelectorAll('.evidence-section[aria-label="observations"] .evidence-card').length`)
          return focused && visible === 3 ? true : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(
        await app.overlayEval<string | null>(`document.querySelector('.evidence-card--focused')?.dataset.evidenceId ?? null`),
      ).toBe('memory-1')
      // The flash is a flash: the highlight clears on its own timer, and
      // one focused card never stacks into two.
      await waitFor(
        async () => ((await app.overlayEval<boolean>(`!document.querySelector('.evidence-card--focused')`)) ? true : undefined),
        { timeoutMs: 5_000, intervalMs: 200 },
      )

      // A second Run decides every Candidate: the changes broadcast and
      // the live cards update — no reload, no duplicate cards, count
      // unchanged.
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')
      const decided = await app.submitCommand('decide the candidates')
      expect(decided).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Accepted the candidate.')) ? true : undefined),
        { timeoutMs: 30_000, intervalMs: 250 },
      )
      // The done boundary may collapse the panel after the run — re-open
      // it inside the wait (the #139 recovery pattern) and only proceed
      // once the overlay's view bounds have actually expanded (a freshly
      // re-opened panel resizes its view asynchronously; clicks before
      // the settle land on stale coordinates).
      await waitFor(
        async () => {
          await app.ensurePanelOpen()
          // Full-panel bounds, not the collapsed faces: the edge tab is
          // 36px wide and the Peek Card slot only ~116px tall (ADR 0029) —
          // a click dispatched against either's stale bounds is dropped.
          if ((await app.overlayEval<number>('innerWidth')) < 320) return undefined
          if ((await app.overlayEval<number>('innerHeight')) < 300) return undefined
          return (await app.overlayEval<string | null>(EVIDENCE_BADGE)) === '6' ? true : undefined
        },
        { timeoutMs: 15_000, intervalMs: 250 },
      )
      await app.clickOverlayElement('.feed-tab--evidence')
      // Newest first: the latest-created Candidate (superseded) renders on
      // top, the first-created (accepted) last — every decision landed,
      // with clock-tick ties broken toward the later creation.
      await waitFor(
        async () => {
          const statuses = await app.overlayEval<string[]>(
            `[...document.querySelectorAll('.evidence-card--candidate')].map((el) => el.dataset.candidateStatus)`,
          )
          return statuses.length === 3 && statuses.join(',') === 'superseded,rejected,accepted' ? statuses : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // Candidate filters follow the live statuses: active matches
      // nothing now; each terminal status matches exactly its one card.
      await clickScrolledOverlayElement(app, candidateFilter('active'))
      expect(await app.overlayEval<number>(`document.querySelectorAll('.evidence-card--candidate').length`)).toBe(0)
      expect(
        await app.overlayEval<string>(`document.querySelector('.evidence-section[aria-label="candidates"] .evidence-section-empty')?.textContent ?? ''`),
      ).toContain('No candidates match this filter.')
      await clickScrolledOverlayElement(app, candidateFilter('accepted'))
      expect(
        await app.overlayEval<string[]>(
          `[...document.querySelectorAll('.evidence-card--candidate')].map((el) => el.dataset.candidateStatus)`,
        ),
      ).toEqual(['accepted'])
      await clickScrolledOverlayElement(app, candidateFilter('rejected'))
      expect(
        await app.overlayEval<string[]>(
          `[...document.querySelectorAll('.evidence-card--candidate')].map((el) => el.dataset.candidateStatus)`,
        ),
      ).toEqual(['rejected'])
      await clickScrolledOverlayElement(app, candidateFilter('superseded'))
      expect(
        await app.overlayEval<string[]>(
          `[...document.querySelectorAll('.evidence-card--candidate')].map((el) => el.dataset.candidateStatus)`,
        ),
      ).toEqual(['superseded'])

      // Internal identities never surface as visible text — not Memory
      // Entry, Run, Observation, or Subagent ids.
      const evidenceText = await app.overlayEval<string>(`document.querySelector('.feed-list')?.textContent ?? ''`)
      expect(evidenceText).not.toMatch(/memory-\d/)
      expect(evidenceText).not.toMatch(/run-\d/)
      expect(evidenceText).not.toMatch(/obs-\d/)
      expect(evidenceText).not.toMatch(/\ba-1\b/)

      // The pane never moved for any of it — the browser is read-only.
      expect(await app.paneUrl()).toBe(page)
    } finally {
      await app.quit()
    }
  })
})
