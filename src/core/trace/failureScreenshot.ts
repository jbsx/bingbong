// The failure_screenshot record (#191, ADR 0031): what the page looked
// like when a Run finalized badly. The vision records keep the answer
// text and never the image, and no other record holds pixels, so a "why
// did it click [55]" post mortem had the snapshot text and nothing of
// what the user was looking at. This is the one record whose payload is
// not in the file: the PNG is a sibling file beside the jsonl, named for
// the Run and turn and purged under the family's 7-day rule, and the
// record names it. It is taken once, for a `done` that finalized failed
// or on a work rail — never for a Run that met its objective, was
// cancelled, or reset — and a capture that throws is a fault, never the
// Run's problem. Nothing here exists unless the Run is tracing
// (`BINGBONG_RUN_TRACE`, #184).

import type { PipelineEvent } from '../pipeline/events'
import type { RunId } from '../session/sessionIdentity'
import { FAILURE_SCREENSHOT_RAIL_CAUSES, type FailureScreenshotCause, type FailureScreenshotEvent } from './runTrace'

function isRailCause(cause: string): cause is (typeof FAILURE_SCREENSHOT_RAIL_CAUSES)[number] {
  return (FAILURE_SCREENSHOT_RAIL_CAUSES as readonly string[]).includes(cause)
}

/**
 * Whether one `done` earns a screenshot, and under which cause: a failed
 * outcome first, then a rail-caused finalization. Null for every other
 * `done` and for any other event, so a caller can ask before entering
 * anything that could fail.
 */
export function failureScreenshotCause(event: PipelineEvent): FailureScreenshotCause | null {
  if (event.type !== 'done') return null
  if (event.outcome === 'failed') return 'failed'
  const cause = event.finalizationCause
  return cause !== undefined && isRailCause(cause) ? cause : null
}

/** What the file the capture wrote is: where, and how big. */
export interface CapturedScreenshot {
  readonly path: string
  readonly bytes: number
}

/**
 * What the Run's runner calls to take the screenshot and put it beside
 * the trace (#191). Main builds it over the visible tab's controller and
 * the logs dir; the core never touches pixels or the filesystem. It may
 * throw — a page that cannot be captured is the caller's fault to report.
 */
export type FailureScreenshotCapture = (identity: { readonly runId: RunId; readonly turnId: string }) => Promise<CapturedScreenshot>

/** One capture as the file records it. */
export function failureScreenshotEvent(cause: FailureScreenshotCause, captured: CapturedScreenshot): FailureScreenshotEvent {
  return { kind: 'failure_screenshot', cause, path: captured.path, bytes: captured.bytes }
}
