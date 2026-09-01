import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { answerAskScript } from './scripts'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { MemoryEntryId } from '../src/core/session/workingMemory'

// Evidence source controls (#144, ADR 0028): web evidence retains the
// page title its grounding observation already named — no second browser
// read or model round — and one shared, non-navigating `Copy source`
// control serves both the Evidence Browser and the Answer Evidence
// Summary. Activating it copies the URL, preserves the visible browser
// whether a Run is active or idle, and reports success or failure beside
// the control through an accessible live region, while ordinary Markdown
// links an Answer authored keep navigating the pane. Real
// main/preload/renderer boundary, scripted orchestrator, real CDP
// browser, real clipboard.

/** Everything Recorded History holds, one line per entry. */
function recordedHistoryText(app: Harness): Promise<string> {
  return app.dashboardEval<string>(
    `(async () => (await window.bingbong.history.recentEntries()).map((entry) => entry.text).join('\\n'))()`,
  )
}

/**
 * Scroll an overlay element into view, then click it: synthetic CDP clicks
 * land on viewport coordinates only, so an element below a list fold must
 * be brought up first.
 */
async function clickScrolledOverlayElement(app: Harness, selector: string): Promise<void> {
  await app.overlayEval(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`)
  await app.clickOverlayElement(selector)
}

/** The copy status text of one control, or null when it renders nothing. */
const copyStatus = (selector: string): string =>
  `document.querySelector(${JSON.stringify(`${selector} .evidence-copy-status`)})?.textContent || null`

/** Waits until one source control's label shows the expected text. */
async function waitForSourceLabel(app: Harness, selector: string, label: string): Promise<string> {
  return waitFor(
    async () => {
      const shown = await app.overlayEval<string>(
        `document.querySelector(${JSON.stringify(`${selector} .evidence-source-label`)})?.textContent ?? ''`,
      )
      return shown === label ? shown : undefined
    },
    { timeoutMs: 10_000, intervalMs: 100 },
  )
}

describe('evidence source controls e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('titled sources, one shared copy control in both surfaces, state untouched, links still navigate', async () => {
    const titled = fixture.url('/widgets-article')
    const untitled = fixture.url('/cookie-echo')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'n1', name: 'navigate', args: { url: titled } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'The widgets guide covers every fixture widget.',
              source_url: titled,
              excerpt: 'Everything about fixture widgets',
            },
          },
          { id: 'n2', name: 'navigate', args: { url: untitled } },
          {
            id: 'e2',
            name: 'record_evidence',
            args: {
              observation: 'The untitled page echoes cookies.',
              source_url: untitled,
              excerpt: 'cookie echo fixture page',
            },
          },
        ],
      },
      {
        kind: 'answer',
        speak: 'Collected both.',
        display: `Collected both sources. The [full guide](${titled}) is the titled one.`,
        evidenceIds: ['memory-1' as MemoryEntryId, 'memory-2' as MemoryEntryId],
      },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await app.ensurePanelOpen()
      expect(await app.submitCommand('collect the two sources')).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Collected both sources.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )

      // The Evidence Browser: the retained titles decide the labels — the
      // titled page's checkpoint names it; the title-less page carries no
      // title (the browser's URL-shaped stand-in is not one), so its label
      // falls back to the hostname. Newest first, so the untitled page
      // leads.
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      const labels = await waitFor(
        async () => {
          const values = await app.overlayEval<string[]>(
            `[...document.querySelectorAll('.evidence-card .evidence-source-label')].map((el) => el.textContent)`,
          )
          return values.length === 2 && values[0] === '127.0.0.1' && values[1] === 'fixture widgets article'
            ? values
            : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(labels).toEqual(['127.0.0.1', 'fixture widgets article'])
      // The URL rides beside the label as plain selectable text.
      expect(
        await app.overlayEval<string>(
          `document.querySelector('.evidence-card[data-evidence-id="memory-1"] .evidence-source-url')?.textContent ?? ''`,
        ),
      ).toBe(titled)

      // Copying from the Evidence Browser: the real clipboard receives the
      // URL, the feedback lands beside the control through the status
      // live region, and the pane — parked on the run's last page —
      // never moves.
      await clickScrolledOverlayElement(app, '.evidence-card[data-evidence-id="memory-1"] .evidence-copy')
      await waitFor(
        async () => ((await app.overlayEval<string>(copyStatus('.evidence-card[data-evidence-id="memory-1"]'))) === 'Source copied' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(
        await app.overlayEval<string>(`document.querySelector('.evidence-card[data-evidence-id="memory-1"] .evidence-copy-status')?.getAttribute('role') ?? ''`),
      ).toBe('status')
      expect(await app.overlayEval<string>(`(async () => navigator.clipboard.readText())()`)).toBe(titled)
      expect(await app.paneUrl()).toBe(untitled)

      // The same shared control in the Answer Evidence Summary: expand the
      // collapsed summary, copy from the titled Observation's card, and
      // the pane still does not move.
      await app.clickOverlayElement('.feed-tab:not(.feed-tab--evidence)')
      await clickScrolledOverlayElement(app, '.feed-entry--display .answer-evidence-summary')
      await waitFor(
        async () => {
          const label = await app.overlayEval<string>(
            `document.querySelector('.answer-evidence-card[data-evidence-id="memory-1"] .evidence-source-label')?.textContent ?? ''`,
          )
          return label === 'fixture widgets article' ? label : undefined
        },
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      await clickScrolledOverlayElement(app, '.answer-evidence-card[data-evidence-id="memory-1"] .evidence-copy')
      await waitFor(
        async () => ((await app.overlayEval<string>(copyStatus('.answer-evidence-card[data-evidence-id="memory-1"]'))) === 'Source copied' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(await app.overlayEval<string>(`(async () => navigator.clipboard.readText())()`)).toBe(titled)
      // Evidence surfaces never navigate: no anchor anywhere in the
      // summary, unlike the Answer's own Markdown above it.
      expect(
        await app.overlayEval<number>(`document.querySelectorAll('.feed-entry--display details.answer-evidence a').length`),
      ).toBe(0)
      expect(await app.paneUrl()).toBe(untitled)

      // Ordinary Markdown links keep their navigation: one click on the
      // Answer's authored link takes the pane to its target.
      await clickScrolledOverlayElement(app, '.feed-entry--display a.feed-link')
      expect(await app.waitForPaneUrl(titled)).toBe(titled)
    } finally {
      await app.quit()
    }
  })

  it('reports a failed copy beside the control and leaves the URL selectable', async () => {
    const titled = fixture.url('/widgets-article')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'n1', name: 'navigate', args: { url: titled } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'The widgets guide covers every fixture widget.',
              source_url: titled,
              excerpt: 'Everything about fixture widgets',
            },
          },
        ],
      },
      { kind: 'answer', speak: 'Noted.', display: 'Noted the titled source.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      expect(await app.submitCommand('note the titled source')).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Noted the titled source.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      await waitForSourceLabel(app, '.evidence-card', 'fixture widgets article')

      // A copy the platform refuses: the renderer's clipboard is stubbed
      // to reject — the control's own honest failure path.
      await app.overlayEval(
        `Object.defineProperty(navigator.clipboard, 'writeText', { value: () => Promise.reject(new Error('denied')) })`,
      )
      await clickScrolledOverlayElement(app, '.evidence-card .evidence-copy')
      expect(await waitFor(
        async () => ((await app.overlayEval<string>(copyStatus('.evidence-card'))) === "Couldn't copy source" ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )).toBe(true)

      // The URL stayed: selectable text, never swallowed by the failure.
      const url = await app.overlayEval<string>(`document.querySelector('.evidence-card .evidence-source-url')?.textContent ?? ''`)
      expect(url).toBe(titled)
      expect(
        await app.overlayEval<string>(`getComputedStyle(document.querySelector('.evidence-card .evidence-source-url')).userSelect`),
      ).not.toBe('none')
      // And the pane never moved for any of it.
      expect(await app.paneUrl()).toBe(titled)
    } finally {
      await app.quit()
    }
  })

  it('copies without disturbing an active run — same behavior live as idle', async () => {
    const titled = fixture.url('/widgets-article')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          { id: 'n1', name: 'navigate', args: { url: titled } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              observation: 'The widgets guide covers every fixture widget.',
              source_url: titled,
              excerpt: 'Everything about fixture widgets',
            },
          },
          // The open ask holds the Run live while the copy happens.
          { id: 'a1', name: 'ask_user', args: { question: 'Finish with the guide?' } },
        ],
      },
      { kind: 'answer', speak: 'Finishing.', display: 'Finished with the guide.' },
    ]
    const app = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      expect(await app.submitCommand('check the guide and ask me')).toBe('submitted')
      await waitFor(
        async () => {
          const question = await app.dashboardEval<string>(`document.querySelector('.ask-question')?.textContent ?? ''`)
          return question === 'Finish with the guide?' ? question : undefined
        },
        { timeoutMs: 15_000, intervalMs: 200 },
      )

      // The Run is live at the ask window: the Evidence Browser is usable
      // and copying moves nothing — not the pane, not the Run.
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      await waitForSourceLabel(app, '.evidence-card', 'fixture widgets article')
      await clickScrolledOverlayElement(app, '.evidence-card .evidence-copy')
      await waitFor(
        async () => ((await app.overlayEval<string>(copyStatus('.evidence-card'))) === 'Source copied' ? true : undefined),
        { timeoutMs: 10_000, intervalMs: 100 },
      )
      expect(await app.overlayEval<string>(`(async () => navigator.clipboard.readText())()`)).toBe(titled)
      expect(await app.paneUrl()).toBe(titled)
      // The ask window is still open — the copy interrupted nothing.
      expect(await app.dashboardEval<string>(`document.querySelector('.ask-question')?.textContent ?? ''`)).toBe('Finish with the guide?')

      // Answering completes the Run normally.
      expect(await app.dashboardEval<string>(answerAskScript('yes'))).toBe('answered')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Finished with the guide.')) ? true : undefined),
        { timeoutMs: 20_000, intervalMs: 250 },
      )
    } finally {
      await app.quit()
    }
  })

  it('delegated evidence keeps the worker-observed title — same no-extra-round path', async () => {
    const titled = fixture.url('/widgets-article')
    const script: AssistantTurn[] = [
      {
        kind: 'tool_calls',
        calls: [
          // Delegation needs the investigation tier (#120).
          {
            id: 'plan',
            name: 'report_run_plan',
            args: { objective: 'Collect the delegated source', headline: 'Collecting', effort_tier: 'investigation' },
          },
          { id: 's1', name: 'spawn_agent', args: { kind: 'browse', task: 'look at the widgets article' } },
        ],
      },
      {
        kind: 'tool_calls',
        calls: [
          { id: 'r1', name: 'agent_results', args: { wait: true } },
          {
            id: 'e1',
            name: 'record_evidence',
            args: {
              kind: 'subagent',
              agent_id: 'a-1',
              observation: 'The worker confirmed the guide covers every fixture widget.',
              source_url: titled,
            },
          },
        ],
      },
      { kind: 'answer', speak: 'Collected.', display: 'Collected the delegated source.' },
    ]
    const worker: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'w1', name: 'navigate', args: { url: titled } }] },
      { kind: 'answer', speak: 'done', display: 'Saw the widgets article.' },
    ]
    const app = await startHarness({
      fixture,
      env: {
        BINGBONG_LLM_SCRIPT: JSON.stringify(script),
        BINGBONG_SUBAGENT_LLM_SCRIPT: JSON.stringify(worker),
      },
    })
    try {
      expect(await app.submitCommand('collect the delegated source')).toBe('submitted')
      await waitFor(
        async () => (((await recordedHistoryText(app)).includes('Collected the delegated source.')) ? true : undefined),
        { timeoutMs: 30_000, intervalMs: 250 },
      )

      // The delegated Observation presents the worker's observed title —
      // carried by the checkpoint itself, not a later read — with the
      // delegation chip beside the web grounding kind.
      await app.ensurePanelOpen()
      await app.clickOverlayElement('.feed-tab--evidence')
      const card = await waitForSourceLabel(app, '.evidence-card', 'fixture widgets article')
      expect(card).toBe('fixture widgets article')
      expect(
        await app.overlayEval<string>(`document.querySelector('.evidence-card .evidence-chip--delegated')?.textContent ?? ''`),
      ).toBe('delegated')
      expect(await app.overlayEval<string>(`document.querySelector('.evidence-card .evidence-kind')?.textContent ?? ''`)).toBe('web')
      expect(await app.paneUrl()).toBe('about:blank')
    } finally {
      await app.quit()
    }
  })
})
