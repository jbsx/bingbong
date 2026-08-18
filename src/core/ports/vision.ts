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

export interface VisionLocator {
  locate(request: VisionLocateRequest): Promise<VisionLocation>
}

export interface VisionDescriber {
  describe(request: VisionDescribeRequest): Promise<string>
}

export interface VisionModel extends VisionLocator, VisionDescriber {}
