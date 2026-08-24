import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'
import type { ScriptedAnswerTurn } from '../src/core/testing/doubles'

// Markdown rendering e2e (#56): answers look structured — react-markdown
// renders assistant display entries and the live streaming answer inside
// the answer cards (dark-styled code blocks, lists, headings,
// emphasis), raw sigils never appear as literal text, and links in the
// feed navigate the main browser pane through the existing navigation
// seam — "open that" is one click.

const OPEN_CHROME = `!!document.querySelector('.overlay-chrome--open .feed-surface')`

/** The structured DOM inside the answer card, from the overlay renderer. */
const MARKDOWN_STRUCTURE = `(() => {
  const card = document.querySelector('.feed-entry--assistant.feed-entry--display .feed-card')
  if (!card) return null
  return {
    heading: card.querySelector('.feed-markdown h2')?.textContent ?? null,
    listItem: card.querySelector('.feed-markdown ul li strong')?.textContent ?? null,
    emphasis: card.querySelector('.feed-markdown ul li em')?.textContent ?? null,
    fenced: card.querySelector('.feed-markdown pre code')?.textContent ?? null,
    fencedBg: card.querySelector('.feed-markdown pre') ? getComputedStyle(card.querySelector('.feed-markdown pre')).backgroundColor : null,
    inlineCode: card.querySelector('.feed-markdown :not(pre) > code')?.textContent ?? null,
    linkHref: card.querySelector('.feed-markdown a.feed-link')?.getAttribute('href') ?? null,
    rawText: card.textContent ?? '',
  }
})()`

async function openPanel(harness: Harness): Promise<void> {
  await harness.clickDashboardElement('.feed-panel-toggle')
  await waitFor(() => harness.overlayEval<boolean>(OPEN_CHROME), { timeoutMs: 5000, intervalMs: 100 })
}

/** One markdown answer carrying every structure the ticket names. */
function markdownAnswer(linkUrl: string): AssistantTurn[] {
  const display = [
    '## Grading rubric',
    '',
    '- **Fast**: ships in a day',
    '- *Slow*: ships *when it ships*',
    '',
    'Run the check with `npm run check`, or:',
    '',
    '```js',
    'console.log("graded")',
    '```',
    '',
    `Reference: [the fixture page](${linkUrl}).`,
  ].join('\n')
  return [{ kind: 'answer', speak: 'Graded.', display }]
}

describe('markdown answers e2e (#56)', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('renders a markdown display answer as structure — headings, lists, emphasis, code, links — with no literal sigils', async () => {
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(markdownAnswer('https://example.com/rubric')) },
    })
    try {
      await openPanel(harness)
      expect(await harness.submitCommand('grade my homework')).toBe('submitted')

      await waitFor(
        () => harness.overlayEval<boolean>(`!!document.querySelector('.feed-entry--display .feed-markdown')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // The settled structure: the overlay's boot hydration can re-base
      // its feed projection right as the display lands (the recorded
      // entries re-seed beside the live ones) — a transient the panel
      // self-heals within ~500ms, same class as the panel-bounds settle
      // the harness already does. Read structure on the settled state.
      const structure = await waitFor(
        () =>
          harness.overlayEval<{
            heading: string | null
            listItem: string | null
            emphasis: string | null
            fenced: string | null
            fencedBg: string | null
            inlineCode: string | null
            linkHref: string | null
            rawText: string
          }>(MARKDOWN_STRUCTURE).then((value) => value ?? undefined),
        { timeoutMs: 10000, intervalMs: 250 },
      )
      expect(structure).not.toBeNull()

      // Structured elements, not sigil soup: every construct renders as
      // its DOM shape inside the card.
      expect(structure!.heading).toBe('Grading rubric')
      expect(structure!.listItem).toBe('Fast')
      expect(structure!.emphasis).toBe('Slow')
      expect(structure!.fenced).toContain('console.log("graded")')
      expect(structure!.inlineCode).toBe('npm run check')
      expect(structure!.linkHref).toBe('https://example.com/rubric')

      // The fenced block reads as the dark surface (ink #1d1d1f).
      expect(structure!.fencedBg).toBe('rgb(29, 29, 31)')

      // Raw markdown sigils never appear as literal text.
      expect(structure!.rawText).not.toContain('**')
      expect(structure!.rawText).not.toContain('##')
      expect(structure!.rawText).not.toContain('`')
      expect(structure!.rawText).not.toContain('[')
    } finally {
      await harness.quit()
    }
  })

  it('shows the typing indicator while the answer streams, before the final display entry', async () => {
    // streamChunks flush mid-stream (each chunk > the 120ms batch window),
    // so the live answer_stream entry holds the orb + typing indicator
    // (ADR 0013: internal JSON never flashes into the view) — then the
    // final display entry renders its markdown and replaces the partial.
    const script: ScriptedAnswerTurn[] = [
      {
        kind: 'answer',
        speak: 'Streamed.',
        display: '## Final answer\n\nThe full display card.',
        streamChunks: ['# Streaming heading\n\n', 'This is **bold** as it arrives.\n\n', 'plain words ', 'and more ', 'tail text.'],
      },
    ]
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) },
    })
    try {
      await openPanel(harness)
      expect(await harness.submitCommand('stream me an answer')).toBe('submitted')

      // Mid-stream: the answer_stream entry shows the orb with the typing
      // indicator — never the raw streaming text.
      await waitFor(
        () =>
          harness.overlayEval<boolean>(
            `(() => {
              const entry = document.querySelector('.feed-entry--answer_stream')
              if (!entry) return false
              const typing = entry.querySelector('.feed-typing')
              const orb = entry.querySelector('.feed-orb')
              const raw = (entry.textContent ?? '').replace(/[\\d:]/g, '')
              return orb && typing && raw.trim() === '' ? true : false
            })()`,
          ),
        { timeoutMs: 20000, intervalMs: 100 },
      )

      // The run is still live — the final display has not replaced the
      // partial yet at the moment the indicator was observed. Then it
      // lands and the partial disappears (one card, never both).
      await waitFor(
        () =>
          harness.overlayEval<boolean>(
            `!!document.querySelector('.feed-entry--display .feed-markdown h2') &&
             !document.querySelector('.feed-entry--answer_stream')`,
          ),
        { timeoutMs: 20000, intervalMs: 250 },
      )
    } finally {
      await harness.quit()
    }
  })

  it('navigates the main browser pane when a link in the feed is clicked', async () => {
    const target = fixture.url('/linked')
    const harness = await startHarness({
      fixture,
      env: { BINGBONG_LLM_SCRIPT: JSON.stringify(markdownAnswer(target)) },
    })
    try {
      await openPanel(harness)
      expect(await harness.submitCommand('grade it again')).toBe('submitted')

      await waitFor(
        () => harness.overlayEval<boolean>(`!!document.querySelector('.feed-entry--display a.feed-link')`),
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // The run's done collapsed the panel to the edge tab (#45) — the
      // feed stays mounted but the overlay view shrinks to nothing, so
      // re-open before clicking (the link survives, entries accumulate).
      await openPanel(harness)

      // One click on the feed's link navigates the main pane — the
      // overlay's click rides the same browser navigation IPC the URL
      // bar uses.
      await harness.clickOverlayElement('.feed-entry--display a.feed-link')
      expect(await harness.waitForPaneUrl(target)).toBe(target)
    } finally {
      await harness.quit()
    }
  })
})
