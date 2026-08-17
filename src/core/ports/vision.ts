import type { CollectedViewport } from '../browser/snapshot'
import type { ViewportPoint } from './browser'

export interface VisionLocateRequest {
  image: Uint8Array
  target: string
  viewport: CollectedViewport
}

export type VisionLocation = ViewportPoint

export interface VisionLocator {
  locate(request: VisionLocateRequest): Promise<VisionLocation>
}
