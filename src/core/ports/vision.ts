import type { CollectedViewport } from '../browser/snapshot'
import type { ViewportPoint } from './browser'

export interface VisionLocateRequest {
  image: Uint8Array
  target: string
  viewport: CollectedViewport
}

export interface VisionDescribeRequest {
  image: Uint8Array
  prompt: string
  /**
   * Whole-Look cap this caller is willing to wait (#106, ADR 0016):
   * auto-vision passes a smaller advisory budget than a model-requested
   * Look. The adapter clamps it to the configured Describe cap and scales
   * the Vision Deadline (first-token window) down with it; absent means
   * the Look's own caps. (Naming: the glossary's Vision Deadline is the
   * first-token wait — this field is the cap, hence lookCapMs.)
   */
  lookCapMs?: number
}

/**
 * Advisory auto-vision budget (#106, ADR 0016): shorter than the Describe
 * Look cap under the default shape; the adapter clamps it so it can never
 * exceed the Look's cap under any env override. The Looks the pipeline
 * fires itself must stop taxing the Run.
 */
export const AUTO_VISION_DESCRIBE_MS = 6_000

export type VisionLocation = ViewportPoint

/** A Look that missed its Vision Deadline (ADR 0016). Typed so callers
 * key advisory behaviour off the error class, not message text. */
export class VisionDeadlineError extends Error {
  constructor(deadlineMs: number, phase: 'first-token' | 'whole-look' = 'whole-look') {
    super(
      phase === 'first-token'
        ? `Vision request did not begin answering within ${deadlineMs}ms`
        : `Vision request timed out after ${deadlineMs}ms`,
    )
    this.name = 'VisionDeadlineError'
  }
}

/** The advisory nudge every Vision Deadline breach carries (ADR 0016) —
 * orchestrator and subagent Looks alike: fall back to the DOM or escalate,
 * never retry look blind. */
export const VISION_DEADLINE_NUDGE =
  'Vision is unavailable right now. Proceed with the DOM snapshot (read_page) or ask_user — do not keep retrying look.'

export interface VisionLocator {
  locate(request: VisionLocateRequest): Promise<VisionLocation>
}

export interface VisionDescriber {
  describe(request: VisionDescribeRequest): Promise<string>
}

export interface VisionModel extends VisionLocator, VisionDescriber {}
