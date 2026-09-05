// The renderer records (#187, ADR 0031): what the page itself did. The
// renderer logged nothing at all and had no diagnostics channel to log
// down, so "something cleared the activity feed" and "the evidence is
// either not saved or not rendered" were the two questions no file could
// answer — #181 records what main handed each view, and this is the
// missing half, what the view did with it.
//
// Every kind here is host-scoped by the boundary rule: a page holds no
// turn identity, so these records name the Active Session main stamps on
// them and never a Run. That is also why they ride `BINGBONG_HOST_TRACE`
// like the voice records beside them.
//
// Payloads are ids and counts only. The main-side tap (#185) already
// holds every Feed Entry's text and the store (#181) already holds every
// Observation's, so a renderer record that repeated either would be a
// second copy of the user's own words written from the least trusted
// side of the app. `rendererReportOf` enforces that structurally: main
// rebuilds each record from the fields declared here and nothing else, so
// a field a future renderer bug adds cannot ride along.

import { isFeedPanelMode, type FeedPanelMode } from '../panel/feedPanelState'
import type { SessionEvidencePayload } from '../session/evidenceIpcChannels'
import type { EvidenceViewState } from '../session/evidenceView'
import { evidenceCountsOf, type SessionEvidenceCounts } from '../session/sessionEvidence'
import type { SessionGeneration, SessionId } from '../session/sessionIdentity'
import type { FaultEvent } from './fault'
import { EVIDENCE_REQUESTERS, type EvidenceRequester } from './runTrace'

/**
 * Which Session-bearing page a record came from. The same two words the
 * Run Trace's `requester` uses (#181), deliberately: `evidence_answered`
 * and `evidence_rendered` are the two halves of one question, and a
 * reader joining them must not have to translate the vocabulary.
 */
export type RendererSurface = EvidenceRequester

/** The pages that may report; anything else is a report main drops. */
export const RENDERER_SURFACES = EVIDENCE_REQUESTERS

/**
 * The prefix every renderer-reported fault site carries. Enforced when
 * the report lands, so a renderer bug can never file a fault under a
 * main-side site name and make a host-side failure look like a page one.
 */
export const RENDERER_FAULT_SITE_PREFIX = 'renderer.'

/** Caps on the free text a renderer may put on the record. */
export const TRACE_RENDERER_SITE_MAX_CHARS = 120
export const TRACE_RENDERER_MESSAGE_MAX_CHARS = 2_000
export const TRACE_RENDERER_STACK_MAX_CHARS = 8_000

/**
 * Why the Feed went empty. Both causes answer the same bug report:
 * `session_ended` is the Session boundary wiping the view it owns,
 * `page_load` is a fresh projection on a page that just loaded — the
 * reload nobody witnessed, which looks identical from the outside.
 */
export type FeedClearCause = 'session_ended' | 'page_load'

/** One Feed wipe as the page made it (#187) — the count only, never a line. */
export interface FeedClearedEvent {
  readonly kind: 'feed_cleared'
  readonly surface: RendererSurface
  readonly cause: FeedClearCause
  /** How many Feed Entries the clear dropped; zero on a fresh page. */
  readonly entries: number
}

/**
 * One Feed Panel open or close as the page saw it (#187). Written on a
 * change to the visible state only — the fold broadcasts on every width
 * drag frame, and a record per frame would be a file about a mouse.
 */
export interface FeedPanelViewEvent {
  readonly kind: 'feed_panel'
  readonly surface: RendererSurface
  readonly open: boolean
  readonly mode: FeedPanelMode
}

/**
 * One authoritative evidence read as the view folded it (#187): what main
 * answered with, beside what the page can actually render afterwards. The
 * pair is the diagnosis — equal counts mean a correct store reached a
 * correct view, and `received` above `rendered` means the fold discarded
 * the answer (a foreign Session, or a read that crossed a clear) rather
 * than the store having lost anything.
 */
export interface EvidenceRenderedEvent {
  readonly kind: 'evidence_rendered'
  readonly surface: RendererSurface
  /** 'session' when main answered with a snapshot, 'no_session' when it answered null. */
  readonly answered: 'session' | 'no_session'
  /** Counts in the answered snapshot; absent on a `no_session` answer. */
  readonly received?: SessionEvidenceCounts
  /** Counts the view holds after the fold — exactly what the page can render. */
  readonly rendered: SessionEvidenceCounts
}

/**
 * One Session re-adoption as the page was told it (ADR 0017, #187). A
 * page that lost its state mid-Session either comes back on its Session
 * or looks like a fresh boot, and nothing on disk said which. `adopted:
 * false` is a real answer rather than a missing one: the page asked and
 * main had no live Session to give it.
 */
export interface SessionReadoptEvent {
  readonly kind: 'session_readopt'
  readonly surface: RendererSurface
  /** `page_load` is the page's own mount pull; `resend` is main's late-load re-send. */
  readonly source: 'page_load' | 'resend'
  readonly adopted: boolean
  /**
   * The Session the page adopted; absent when there was none to adopt.
   * Named apart from the record's own `sessionId` on purpose: the writer
   * stamps the Active Session main knows about, and the two disagreeing
   * is the re-adoption bug this record exists to catch.
   */
  readonly adoptedSessionId?: SessionId
  readonly adoptedGeneration?: SessionGeneration
}

/** The four records the renderer owns; they widen the Host Trace family. */
export type RendererTraceEvent =
  | FeedClearedEvent
  | FeedPanelViewEvent
  | EvidenceRenderedEvent
  | SessionReadoptEvent

/**
 * What `diagnostics.report` accepts. A fault rides the same channel
 * rather than a second one: the renderer's `window.onerror` and its
 * swallowed catches are the same kind of thing as main's, and they belong
 * under the one record kind a reader already greps for.
 */
export type RendererReport = FaultEvent | RendererTraceEvent

/**
 * What of the panel's folded state this family records. The width is
 * deliberately not here: the fold broadcasts on every frame of a width
 * drag, and a record per frame would be a file about a mouse. The mode
 * is, because docking and overlaying are the same kind of fact as being
 * open — where the panel is, not how wide.
 */
export type FeedPanelView = Pick<FeedPanelViewEvent, 'open' | 'mode'>

/** Whether two broadcasts say the same thing about where the panel is. */
export function sameFeedPanelView(before: FeedPanelView | null, after: FeedPanelView): boolean {
  return before !== null && before.open === after.open && before.mode === after.mode
}

/**
 * Builds the record for one authoritative read, from the answer main gave
 * and the view state the fold left behind. A builder rather than a
 * literal at the call site because this is where the no-text rule is
 * kept: both sides arrive as arrays of Observations and leave as three
 * numbers, so there is no shape of this record that can carry evidence
 * text.
 */
export function evidenceRenderedEvent(input: {
  surface: RendererSurface
  /** What main answered with — null is the definitive no-Session answer. */
  payload: SessionEvidencePayload | null
  /** The view after `applyResponse` — what the page will render. */
  view: EvidenceViewState
}): EvidenceRenderedEvent {
  // Both sides counted the one way (`evidenceCountsOf`), which is what
  // lets this record be read against #181's `evidence_answered` at all.
  const rendered = evidenceCountsOf(input.view)
  if (input.payload === null) {
    return { kind: 'evidence_rendered', surface: input.surface, answered: 'no_session', rendered }
  }
  return {
    kind: 'evidence_rendered',
    surface: input.surface,
    answered: 'session',
    received: evidenceCountsOf(input.payload.snapshot),
    rendered,
  }
}

function isSurface(value: unknown): value is RendererSurface {
  return typeof value === 'string' && (RENDERER_SURFACES as readonly string[]).includes(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** The three counts, rebuilt field by field; null when any is not a count. */
function readCounts(value: unknown): SessionEvidenceCounts | null {
  if (typeof value !== 'object' || value === null) return null
  const counts = value as Record<string, unknown>
  if (!isCount(counts.observations) || !isCount(counts.candidates) || !isCount(counts.contradictions)) return null
  return {
    observations: counts.observations,
    candidates: counts.candidates,
    contradictions: counts.contradictions,
  }
}

/** A non-empty string, cut to its cap; null when it is not one. */
function readText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string' || value === '') return null
  return value.slice(0, maxChars)
}

/**
 * Rebuilds one renderer report from a value that crossed the wire, or
 * returns null when it is not a report main is willing to write.
 *
 * Rebuilds rather than validates, which is the point: the record main
 * writes is assembled here out of the fields declared above, so no Feed
 * Entry text, no Observation text and no field anyone adds later can ride
 * into the file on a renderer's say-so. A malformed report is dropped in
 * silence — the renderer is not owed an error for a record it asked for,
 * and a report that fails to parse must never become a second failure.
 */
export function rendererReportOf(value: unknown): RendererReport | null {
  if (typeof value !== 'object' || value === null) return null
  const report = value as Record<string, unknown>
  switch (report.kind) {
    case 'fault': {
      const site = readText(report.site, TRACE_RENDERER_SITE_MAX_CHARS)
      const message = readText(report.message, TRACE_RENDERER_MESSAGE_MAX_CHARS)
      if (site === null || message === null || !site.startsWith(RENDERER_FAULT_SITE_PREFIX)) return null
      const stack = readText(report.stack, TRACE_RENDERER_STACK_MAX_CHARS)
      return { kind: 'fault', site, message, ...(stack !== null ? { stack } : {}) }
    }
    case 'feed_cleared': {
      if (!isSurface(report.surface) || !isCount(report.entries)) return null
      if (report.cause !== 'session_ended' && report.cause !== 'page_load') return null
      return { kind: 'feed_cleared', surface: report.surface, cause: report.cause, entries: report.entries }
    }
    case 'feed_panel': {
      if (!isSurface(report.surface) || typeof report.open !== 'boolean' || !isFeedPanelMode(report.mode)) return null
      return { kind: 'feed_panel', surface: report.surface, open: report.open, mode: report.mode }
    }
    case 'evidence_rendered': {
      const rendered = readCounts(report.rendered)
      if (!isSurface(report.surface) || rendered === null) return null
      if (report.answered === 'no_session') {
        return { kind: 'evidence_rendered', surface: report.surface, answered: 'no_session', rendered }
      }
      const received = readCounts(report.received)
      if (report.answered !== 'session' || received === null) return null
      return { kind: 'evidence_rendered', surface: report.surface, answered: 'session', received, rendered }
    }
    case 'session_readopt': {
      if (!isSurface(report.surface) || typeof report.adopted !== 'boolean') return null
      if (report.source !== 'page_load' && report.source !== 'resend') return null
      const asked = { kind: 'session_readopt', surface: report.surface, source: report.source } as const
      if (!report.adopted) return { ...asked, adopted: false }
      if (typeof report.adoptedSessionId !== 'string' || !Number.isInteger(report.adoptedGeneration)) return null
      return {
        ...asked,
        adopted: true,
        adoptedSessionId: report.adoptedSessionId as SessionId,
        adoptedGeneration: report.adoptedGeneration as SessionGeneration,
      }
    }
    default:
      return null
  }
}
