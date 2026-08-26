export interface UserAgentContext {
  appName: string
  appVersion: string
  electronVersion: string
}

// Chromium's UA freeze: real desktop builds report major.0.0.0, while
// Electron reports the real full build number — itself an embedder tell no
// genuine browser produces (ADR 0018).
const UNREDUCED_CHROME_TOKEN = /Chrome\/(\d+)\.\d+\.\d+\.\d+/

export function browserUserAgent(ua: string, context: UserAgentContext): string {
  return ua
    .replace(`${context.appName}/${context.appVersion}`, '')
    .replace(`Electron/${context.electronVersion}`, '')
    .replace(UNREDUCED_CHROME_TOKEN, (_match, major: string) => `Chrome/${major}.0.0.0`)
    .replace(/\s+/g, ' ')
    .trim()
}
