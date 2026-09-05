import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { tracedEvents } from './runTrace'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { MemoryEntryId } from '../src/core/session/workingMemory'

// The Evidence Browser's lifecycle hardening (#145): the selected view is
// Session-owned state in main, so Evidence and its selection survive
// docking, undocking, reload, and renderer crash within the Session — and
// every Session end (Reset, Lapse, interruption) destroys both, leaves the
// ended Session's snapshot unavailable, and returns the panel to Activity,
// the default view of every newly created Session. Run cancellation is not
// Session interruption: Stop keeps the Session's evidence. Application
// relaunch restores no Evidence Browser data, and with Recorded History
// retired (#188) there is no always-on store left for it to be recovered
// from at all — the Run and its evidence survive only in the opt-in Run
// Trace this suite enables. Real main/preload/renderer boundary, real
// Electron lifecycle, scripted orchestrator, real CDP browser.

/** The `Evidence N` control's badge text, or null when no badge shows. */
const EVIDENCE_BADGE = `document.querySelector('.feed-tab--evidence .feed-tab-count')?.textContent ?? null`

/** The live count on the dashboard's feed slot — readable whichever view the panel shows. */
const SLOT_EVIDENCE_COUNT = `document.querySelector('.feed-slot')?.dataset.evidenceCount ?? null`

/** Which panel view is shown: 'session evidence' or 'activity feed'. */
const PANEL_VIEW = `document.querySelector('.feed')?.getAttribute('aria-label') ?? ''`

/** The authoritative evidence pull, as the renderer API answers it. */
const EVIDENCE_PULL = `(async () => await window.bingbong.evidence.get())()`

/** The Session-owned selected view, straight from main's fold. */
const VIEW_PULL = `(async () => await window.bingbong.evidence.getView())()`

function checkpointTurn(page: string, observation: string): AssistantTurn {
  return {
    kind: 'tool_calls',
    calls: [
      { id: 'n1', name: 'navigate', args: { url: page } },
      { id: 'e1', name: 'record_evidence', args: { observation, source_url: page, excerpt: 'second fixture page' } },
    ],
  }
}

/** Runs the command and waits until its answer landed in the Run Trace. */
async function submitAndRecord(app: Harness, command: string, marker: string): Promise<void> {
  const submitted = await app.submitCommand(command)
  expect(submitted).toBe('submitted')
  await waitFor(
    async () => ((app.runTraceTranscript().includes(marker)) ? true : undefined),
    { timeoutMs: 30_000, intervalMs: 250 },
  )
}

/** Waits until the header badge reads exactly `text` (or is gone for null). */
async function waitForEvidenceBadge(app: Harness, text: string | null): Promise<void> {
  await waitFor(
    async () => {
      await app.ensurePanelOpen()
      return (await app.overlayEval<string | null>(EVIDENCE_BADGE)) === text ? true : undefined
    },
    { timeoutMs: 20_000, intervalMs: 100 },
  )
}

/** Waits until the overlay shows the Evidence view holding exactly `count` cards. */
async function waitForEvidenceCards(app: Harness, count: number): Promise<string[]> {
  return waitFor(
    async () => {
      await app.ensurePanelOpen()
      const texts = await app.overlayEval<string[]>(
        `[...document.querySelectorAll('.evidence-card .evidence-text')].map((el) => el.textContent)`,
      )
      return texts.length === count ? texts : undefined
    },
    { timeoutMs: 20_000, intervalMs: 250 },
  )
}

describe('evidence browser lifecycle e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('the selected Evidence view and its snapshot survive docking, undocking, reload, and renderer crash', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      checkpointTurn(page, 'The second fixture page carries the heading.'),
      { kind: 'answer', speak: 'Noted.', display: 'SESSION A DONE.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await submitAndRecord(app, 'note what the second page says', 'SESSION A DONE.')
      await waitForEvidenceBadge(app, '1')

      // Select Evidence — the selection this whole test carries around.
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      const [card] = await waitForEvidenceCards(app, 1)
      expect(card).toContain('The second fixture page carries the heading.')

      // Docking: the same page, re-laid-out — the selected view and the
      // snapshot stay exactly where they were.
      await app.clickOverlayElement('button[aria-label="Dock the feed panel"]')
      await waitFor(
        async () => ((await app.overlayEval<boolean>(`!!document.querySelector('.feed-surface--docked')`)) || undefined),
        { timeoutMs: 5_000, intervalMs: 100 },
      )
      expect(await app.overlayEval<string>(PANEL_VIEW)).toBe('session evidence')
      expect((await waitForEvidenceCards(app, 1))[0]).toContain('The second fixture page carries the heading.')

      // Undocking: back to the floating surface, still on Evidence.
      await app.clickOverlayElement('button[aria-label="Undock the feed panel"]')
      await waitFor(
        async () => ((await app.overlayEval<boolean>(`!!document.querySelector('.feed-surface--overlay')`)) || undefined),
        { timeoutMs: 5_000, intervalMs: 100 },
      )
      expect(await app.overlayEval<string>(PANEL_VIEW)).toBe('session evidence')
      expect((await waitForEvidenceCards(app, 1))[0]).toContain('The second fixture page carries the heading.')

      // Reload: the page is lost mid-Session. The recovered page re-adopts
      // the Session, restores the complete snapshot, and returns to the
      // selected Evidence view — the selection is Session state, not page
      // state. (The count rides the dashboard's slot: the activity tab's
      // badge is not in the DOM while the Evidence view is shown.)
      await app.overlayEval('location.reload()')
      expect(await waitForEvidenceCards(app, 1)).toContain('The second fixture page carries the heading.')
      expect(await app.overlayEval<string>(PANEL_VIEW)).toBe('session evidence')
      expect(await app.dashboardEval<string | null>(SLOT_EVIDENCE_COUNT)).toBe('1')

      // Renderer crash: the process itself dies. Main reloads it, and the
      // same recovery holds — snapshot, count, and selected view.
      await app.crashRenderer('overlay')
      expect(await waitForEvidenceCards(app, 1)).toContain('The second fixture page carries the heading.')
      expect(await app.overlayEval<string>(PANEL_VIEW)).toBe('session evidence')
      expect(await app.dashboardEval<string | null>(SLOT_EVIDENCE_COUNT)).toBe('1')

      // The dashboard is the other Session-bearing renderer: its crash
      // recovers the same way — the live count restores on its slot, and
      // the panel (never crashed) keeps the selected view and snapshot.
      await app.crashRenderer('dashboard')
      await waitFor(
        async () => ((await app.dashboardEval<string | null>(SLOT_EVIDENCE_COUNT)) === '1' ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      expect(await app.overlayEval<string>(PANEL_VIEW)).toBe('session evidence')
      expect((await waitForEvidenceCards(app, 1))[0]).toContain('The second fixture page carries the heading.')

      // Main's fold is the authority both pages read: the dashboard pulls
      // the same selected view.
      expect(await app.dashboardEval<string>(VIEW_PULL)).toBe('evidence')
    } finally {
      await app.quit()
    }
  })

  it('Session Reset ends the evidence boundary — Activity returns, the snapshot is unavailable, and a replacement Session starts clean', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      // Session A: one Observation lands.
      checkpointTurn(page, 'Session A saw the heading.'),
      { kind: 'answer', speak: 'Noted.', display: 'SESSION A DONE.' },
      // The resetting command: consumed at the new_session boundary; the
      // command restarts as Session B's first work and answers.
      { kind: 'tool_calls', calls: [{ id: 'r1', name: 'new_session', args: {} }] },
      { kind: 'answer', speak: 'Fresh.', display: 'SESSION B STARTED.' },
      // A later command in Session B checkpoints its own evidence.
      checkpointTurn(page, 'Session B saw the heading too.'),
      { kind: 'answer', speak: 'Noted again.', display: 'SESSION B DONE.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      // Watch the lifecycle from the dashboard: the ended Session's
      // identity is what stale evidence would carry.
      await app.dashboardEval(`
        globalThis.__evidenceLifecycle = []
        window.bingbong.assistant.onEvent((event) => {
          if (event.type === 'session_started' || event.type === 'session_ended') {
            globalThis.__evidenceLifecycle.push(\`\${event.type}:\${event.sessionId}:\${event.sessionGeneration}\`)
          }
        })
      `)
      await submitAndRecord(app, 'note what the second page says', 'SESSION A DONE.')
      await waitForEvidenceBadge(app, '1')
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      expect((await waitForEvidenceCards(app, 1))[0]).toContain('Session A saw the heading.')

      // The interruption path (#99): new_session consumes the run, ends
      // Session A (reason reset), and the command restarts in Session B.
      await submitAndRecord(app, 'forget all that — different question', 'SESSION B STARTED.')
      await waitFor(
        async () => ((await app.dashboardEval<string[]>('globalThis.__evidenceLifecycle')).length >= 3 ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // The boundary crossed: the panel returned to Activity — the default
      // view of the newly created Session — the visible evidence cleared,
      // and the ended Session's snapshot is unavailable at the authority.
      await waitFor(
        async () => {
          await app.ensurePanelOpen()
          return (await app.overlayEval<string>(PANEL_VIEW)) === 'activity feed' ? true : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(await app.overlayEval<string | null>(EVIDENCE_BADGE)).toBeNull()
      expect(await app.dashboardEval<string>(VIEW_PULL)).toBe('activity')
      expect(await app.dashboardEval<unknown>(EVIDENCE_PULL)).toMatchObject({
        snapshot: { observations: [], candidates: [], contradictions: [] },
      })
      await app.clickOverlayElement('.feed-tab--evidence')
      expect(await app.overlayEval<string>(`document.querySelector('.feed-empty')?.textContent ?? ''`)).toContain(
        'Nothing has been checkpointed',
      )
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')

      // The lifecycle transition left the evidence nowhere a renderer can
      // reach it. Recorded History was the store that question used to be
      // asked of; it is retired (#188), so the preload surface offers no
      // history API at all and the profile keeps no database.
      expect(await app.dashboardEval<boolean>(`'history' in window.bingbong`)).toBe(false)
      expect(existsSync(join(app.userDataDir, 'history.db'))).toBe(false)

      // Stale-generation isolation (#145): Session B checkpoints its own
      // evidence and the browser shows exactly it — the replacement
      // Session never inherits a card, a count, or a notification from the
      // identity it superseded.
      await submitAndRecord(app, 'note it once more', 'SESSION B DONE.')
      await waitForEvidenceBadge(app, '1')
      await app.clickOverlayElement('.feed-tab--evidence')
      const cards = await waitForEvidenceCards(app, 1)
      expect(cards.join('\n')).toContain('Session B saw the heading too.')
      expect(cards.join('\n')).not.toContain('Session A saw the heading.')
    } finally {
      await app.quit()
    }
  })

  it('a Lapse ends the same boundary immediately — a renderer recovered across the end never resurrects the old Session', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      checkpointTurn(page, 'The soon-lapsed Session saw the heading.'),
      { kind: 'answer', speak: 'Noted.', display: 'SESSION A DONE.' },
    ]
    const app = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_SESSION_WINDOW_MS: '8000',
        BINGBONG_SESSION_WARNING_MS: '4000',
      },
    })
    try {
      await app.dashboardEval(`
        globalThis.__lapseEnds = []
        window.bingbong.assistant.onEvent((event) => {
          if (event.type === 'session_ended') globalThis.__lapseEnds.push(\`\${event.sessionId}:\${event.reason}\`)
        })
      `)
      await submitAndRecord(app, 'note what the second page says', 'SESSION A DONE.')
      await waitForEvidenceBadge(app, '1')
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      expect((await waitForEvidenceCards(app, 1))[0]).toContain('The soon-lapsed Session saw the heading.')

      // The panel's renderer dies while the Session lives — its recovery
      // pull lands in the old Session's window, then the Session lapses
      // underneath it. Everything the recovered page could hold from the
      // ended identity must be gone: the asynchronous old-Session response
      // is discarded, not applied back. (The evidence channels are
      // main→renderer — a page cannot inject onto them — so stale
      // payloads are covered synthetically at the view fold
      // (evidenceView.test.ts) and here through the deterministic
      // recovered-across-the-end race.)
      await app.crashRenderer('overlay')
      await waitFor(
        async () => ((await app.dashboardEval<number>(`globalThis.__lapseEnds.length`)) === 1 ? true : undefined),
        { timeoutMs: 15_000, intervalMs: 250 },
      )
      expect(await app.dashboardEval<string[]>('globalThis.__lapseEnds')).toEqual(
        [expect.stringMatching(/:lapsed$/)],
      )

      // The ended Session's boundary: no snapshot at the authority, no
      // badge, and the panel back on Activity — the selection died with
      // the Session, whatever the recovered page last held.
      expect(await app.dashboardEval<unknown>(EVIDENCE_PULL)).toBeNull()
      await waitFor(
        async () => {
          await app.ensurePanelOpen()
          return (await app.overlayEval<string>(PANEL_VIEW)) === 'activity feed' ? true : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(await app.overlayEval<string | null>(EVIDENCE_BADGE)).toBeNull()
      expect(await app.dashboardEval<string>(VIEW_PULL)).toBe('activity')

      // The recovered page's own view: the old Session's card it briefly
      // held is gone from its rendered Evidence Browser too — opening the
      // (empty) browser shows nothing resurrected.
      await app.clickOverlayElement('.feed-tab--evidence')
      expect(await app.overlayEval<string>(`document.querySelector('.feed-empty')?.textContent ?? ''`)).toContain(
        'Nothing has been checkpointed',
      )
      expect(await app.overlayEval<string>(`document.body.textContent`)).not.toContain(
        'The soon-lapsed Session saw the heading.',
      )
    } finally {
      await app.quit()
    }
  })

  it('Run cancellation is not Session interruption — Stop keeps the evidence; the interruption clears it', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      checkpointTurn(page, 'Before the stop, the heading was noted.'),
      { kind: 'answer', speak: 'Noted.', display: 'SESSION A DONE.' },
      // A run that stalls inside the slow navigation — the Stop button's
      // target. Its cancellation consumes exactly this turn; the next
      // turn is the resetting run's, so a successful abort leaves the
      // script positioned for the interruption below.
      { kind: 'tool_calls', calls: [{ id: 's1', name: 'navigate', args: { url: fixture.url('/slow') } }] },
      { kind: 'tool_calls', calls: [{ id: 'r1', name: 'new_session', args: {} }] },
      { kind: 'answer', speak: 'Fresh.', display: 'SESSION B STARTED.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await submitAndRecord(app, 'note what the second page says', 'SESSION A DONE.')
      await waitForEvidenceBadge(app, '1')

      // A second Run goes live and is cancelled by the panel's Stop — a
      // Run boundary, not a Session one.
      const submitted = await app.submitCommand('open the slow page')
      expect(submitted).toBe('submitted')
      await waitFor(
        async () => ((await app.overlayEval<boolean>(`!!document.querySelector('.panel-stop')`)) || undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      await app.clickOverlayElement('.panel-stop')
      // The stop button's disappearance is the run boundary: it rides the
      // same run-live signal the pipeline drives, and the cancelled orb
      // deliberately stays "cancelled" (not idle) until the next event.
      await waitFor(
        async () => ((await app.overlayEval<boolean>(`!document.querySelector('.panel-stop')`)) || undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )

      // Cancellation cleared nothing: the Session, its snapshot, and the
      // count all stand — evidence survives a cancelled Run (ADR 0028).
      await app.ensurePanelOpen()
      expect(await app.overlayEval<string | null>(EVIDENCE_BADGE)).toBe('1')
      expect(
        await app.dashboardEval<number>(`(async () => (await window.bingbong.evidence.get()).snapshot.observations.length)()`),
      ).toBe(1)

      // The Session interruption is the boundary that clears: the same
      // evidence-clearing path as Reset and Lapse, not the Stop's cancel.
      await submitAndRecord(app, 'forget all that — different question', 'SESSION B STARTED.')
      await waitForEvidenceBadge(app, null)
      expect(await app.dashboardEval<unknown>(EVIDENCE_PULL)).toMatchObject({
        snapshot: { observations: [], candidates: [], contradictions: [] },
      })
      expect(await app.overlayEval<string>(PANEL_VIEW)).toBe('activity feed')
    } finally {
      await app.quit()
    }
  })

  it('application relaunch restores no Evidence Browser data — only the opt-in Run Trace outlives the Session', async () => {
    const page = fixture.url('/second')
    const script: AssistantTurn[] = [
      checkpointTurn(page, 'The heading was checkpointed before the close.'),
      {
        kind: 'answer',
        speak: 'Noted.',
        display: 'SESSION A DONE.',
        evidenceIds: ['memory-1' as MemoryEntryId],
      },
    ]
    const userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-evidence-relaunch-'))
    try {
      const first = await startHarness({
        fixture,
        userDataDir,
        env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
      })
      try {
        await submitAndRecord(first, 'note what the second page says', 'SESSION A DONE.')
        await waitForEvidenceBadge(first, '1')
        // The Answer declared its evidence, so the Run Trace holds the
        // `display` event as published — its text and its derived source.
        await waitFor(
          async () =>
            tracedEvents(first.readRunTrace(), 'display').some(
              (event) => event.text.includes('SESSION A DONE.') && (event.sources ?? []).some((source) => source.url === page),
            ) || undefined,
          { timeoutMs: 10_000, intervalMs: 250 },
        )
      } finally {
        await first.quit()
      }

      const second = await startHarness({
        fixture,
        userDataDir,
        env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
      })
      try {
        // No Session exists after relaunch: the evidence authority answers
        // null — nothing was reconstructed, and the Session-owned view
        // fold is back at its Activity default.
        await waitFor(
          async () => ((await second.dashboardEval<unknown>(EVIDENCE_PULL)) === null ? true : undefined),
          { timeoutMs: 10_000, intervalMs: 250 },
        )
        expect(await second.dashboardEval<string>(VIEW_PULL)).toBe('activity')
        await second.ensurePanelOpen()
        expect(await second.overlayEval<string>(PANEL_VIEW)).toBe('activity feed')
        expect(await second.overlayEval<string | null>(EVIDENCE_BADGE)).toBeNull()

        // The closed Session's Answer survives in one place only: the Run
        // Trace file the developer opted into, which the relaunched app
        // appends to rather than reads. Nothing renderer-reachable holds
        // it — the history API is gone and no database came back.
        const recorded = second.runTraceTranscript()
        expect(recorded).toContain('SESSION A DONE.')
        expect(recorded).toContain('The heading was checkpointed before the close.')
        expect(await second.dashboardEval<boolean>(`'history' in window.bingbong`)).toBe(false)
        expect(existsSync(join(userDataDir, 'history.db'))).toBe(false)
      } finally {
        await second.quit()
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
