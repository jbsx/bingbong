export interface BingbongApi {
  version: string
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
