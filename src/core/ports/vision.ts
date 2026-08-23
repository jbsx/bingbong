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

/** A Look that missed its Vision Deadline (ADR 0008). Typed so callers key
 * advisory behaviour off the error class, not message text. */
export class VisionDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`Vision request timed out after ${deadlineMs}ms`)
    this.name = 'VisionDeadlineError'
  }
}

export interface VisionLocator {
  locate(request: VisionLocateRequest): Promise<VisionLocation>
}

export interface VisionDescriber {
  describe(request: VisionDescribeRequest): Promise<string>
}

export interface VisionModel extends VisionLocator, VisionDescriber {}
