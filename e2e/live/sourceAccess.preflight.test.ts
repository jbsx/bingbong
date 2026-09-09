import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from '../harness'
import { LIVE_ARTIFACTS_ROOT } from './artifacts.ts'
import { buildLiveKeyManifest } from './keyManifest.ts'
import { composeMeasuredLaunch, gitProvenance, loadEnvFile } from './launch.ts'
import { createBenchmarkProfile } from './profile.ts'

// THE LIVE-ACCESS PREFLIGHT (#227, acceptance criterion 3).
//
// Every fact in the keys was verified with an evaluator-side HTTP fetch. That
// establishes what the pages SAY; it establishes nothing about whether the
// app's embedded browser can reach and render them under production settings
// and ad blocking. Consent walls, Beta banners and login UI are live-site
// behaviour a fetch never meets, and a hunt whose sources cannot be opened is
// not a hard task — it is an unanswerable one, and paying to discover that is
// the waste this check exists to prevent.
//
// IT SPENDS NOTHING. No command is submitted, so no model runs: the evaluator
// drives the browser pane directly over CDP. It reads pages; it never types
// into them.
//
// IT MUST NOT SEED AN ATTEMPT. #227 requires the preflight to happen outside
// measured Sessions and starting profiles, so it takes its own benchmark
// profile from the same seed recipe and disposes of it. A measured hunt
// reconstructs its profile from that recipe too, so no cookie, consent
// decision or cached page here can reach one.
//
// IT SOLVES NOTHING. No consent button is clicked, nothing is logged into and
// no site is contacted. A wall is recorded as a wall. Clicking "accept" would
// both change the site's behaviour for a state the measured attempt will not
// have, and answer a question the measured attempt has to answer itself.
//
// THE URLS COME FROM THE KEYS. Read out of the manifest's `referenceSources`
// rather than copied, because a preflight checking a page the key does not
// rest on would be reassuring and worthless.
//
// It asserts almost nothing. A consent wall or a dead URL is a finding to
// report before the pilot, not a red test; the suite fails only when the
// preflight itself could not observe.

/** What one source page did when the real embedded browser asked for it. */
interface SourceObservation {
  readonly url: string
  readonly hunts: readonly string[]
  readonly reached: boolean
  /** Where the browser ended up — a redirect away from the key's page matters. */
  readonly finalUrl: string | null
  readonly title: string | null
  readonly httpish: string | null
  /** Length only, never the text: a source page's text is answer material. */
  readonly renderedTextLength: number | null
  readonly consentLikely: boolean
  readonly loginLikely: boolean
  readonly failure: string | null
}

/**
 * Read the pane's own account of itself. Returns shapes and lengths, never
 * page text — this record is meant to be safe to summarise in a committed
 * report, and a source page's prose is exactly what the assistant is supposed
 * to go and find.
 */
const OBSERVE = `(() => {
  const body = document.body
  const text = body ? (body.innerText || '') : ''
  const lower = text.toLowerCase()
  const selector = [
    '[id*="cookie" i]', '[class*="cookie" i]',
    '[id*="consent" i]', '[class*="consent" i]',
    '[id*="onetrust" i]', '[class*="onetrust" i]',
    'dialog[open]', '[role="dialog"]', '[role="alertdialog"]',
  ].join(',')
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 20) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
  }
  let consent = false
  for (const el of document.querySelectorAll(selector)) {
    if (visible(el)) { consent = true; break }
  }
  const phrases = ['accept all', 'accept cookies', 'manage cookies', 'your privacy choices', 'we use cookies']
  if (!consent) consent = phrases.some((phrase) => lower.includes(phrase))
  const login =
    document.querySelector('input[type="password"]') !== null ||
    lower.includes('sign in to continue') ||
    lower.includes('log in to continue')
  return {
    finalUrl: location.href,
    title: document.title || null,
    renderedTextLength: text.trim().length,
    consentLikely: consent,
    loginLikely: login,
  }
})()`

/** Every page the keys rest on, each with the hunts that rest on it. */
function sourcesFromKeys(): { url: string; hunts: string[] }[] {
  const byUrl = new Map<string, Set<string>>()
  for (const task of buildLiveKeyManifest().tasks) {
    for (const url of task.referenceSources ?? []) {
      const hunts = byUrl.get(url) ?? new Set<string>()
      hunts.add(`${task.huntId}/${task.stepId}`)
      byUrl.set(url, hunts)
    }
  }
  return [...byUrl.entries()].map(([url, hunts]) => ({ url, hunts: [...hunts].sort() }))
}

const NAVIGATE_MS = 90_000
const SETTLE_MS = 3_000

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} exceeded ${ms} ms`)), ms).unref?.()),
  ])
}

describe('the key’s source pages, through the real embedded browser (#227)', () => {
  const observations: SourceObservation[] = []
  let recordPath: string | null = null

  afterAll(() => {
    if (observations.length === 0) return
    recordPath = join(LIVE_ARTIFACTS_ROOT, `preflight-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(
      recordPath,
      `${JSON.stringify({ kind: 'bingbong.live.source-preflight', observedAt: new Date().toISOString(), observations }, null, 2)}\n`,
    )
    for (const observation of observations) {
      const status = observation.reached
        ? `${observation.httpish ?? 'loaded'} ${observation.renderedTextLength ?? 0} chars` +
          `${observation.consentLikely ? ' CONSENT' : ''}${observation.loginLikely ? ' LOGIN' : ''}`
        : `UNREACHED (${observation.failure})`
      console.log(`${status}\n  ${observation.url}\n  for ${observation.hunts.join(', ')}`)
    }
    console.log(`\npreflight record: ${recordPath}`)
  })

  it(
    'reaches and renders every page the keys rest on, or says which it did not',
    async () => {
      const sources = sourcesFromKeys()
      expect(sources.length, 'the keys name no sources at all').toBeGreaterThan(0)

      // The pilot's own launch composition, so this is the pilot's browser
      // and not merely a browser: same production routing resolution, same
      // ad blocking, same access guard, same benchmark profile recipe.
      const profile = createBenchmarkProfile()
      const composed = composeMeasuredLaunch({
        profile,
        envFile: loadEnvFile(process.env),
        processEnv: process.env,
        git: gitProvenance(),
      })

      let harness: Harness | null = null
      try {
        harness = await startHarness({
          userDataDir: profile.userDataDir,
          env: composed.env,
          productionDefaults: composed.productionDefaults,
          startupTimeoutMs: 120_000,
        })

        for (const source of sources) {
          try {
            await withTimeout(harness.navigatePane(source.url), NAVIGATE_MS, `navigating to ${source.url}`)
            // Client-rendered pages (RMG's Beta collection views) paint after
            // load; give them a settle window rather than reporting an empty
            // body as a failure to render.
            await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
            const seen = await withTimeout(
              harness.paneEval<{
                finalUrl: string
                title: string | null
                renderedTextLength: number
                consentLikely: boolean
                loginLikely: boolean
              }>(OBSERVE),
              30_000,
              `observing ${source.url}`,
            )
            observations.push({
              url: source.url,
              hunts: source.hunts,
              reached: true,
              finalUrl: seen.finalUrl,
              title: seen.title,
              httpish: seen.finalUrl === source.url ? 'same-url' : 'redirected',
              renderedTextLength: seen.renderedTextLength,
              consentLikely: seen.consentLikely,
              loginLikely: seen.loginLikely,
              failure: null,
            })
          } catch (error) {
            observations.push({
              url: source.url,
              hunts: source.hunts,
              reached: false,
              finalUrl: null,
              title: null,
              httpish: null,
              renderedTextLength: null,
              consentLikely: false,
              loginLikely: false,
              failure: (error as Error).message.slice(0, 300),
            })
          }
        }
      } finally {
        if (harness) await harness.quit().catch(() => {})
        profile.dispose()
      }

      // The only failure this suite recognises: it could not observe at all.
      // Every page having a consent wall is a reportable finding, not a bug.
      expect(observations).toHaveLength(sources.length)
    },
    30 * 60_000,
  )
})
