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
}

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
