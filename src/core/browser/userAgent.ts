export interface UserAgentContext {
  appName: string
  appVersion: string
  electronVersion: string
}

export function browserUserAgent(ua: string, context: UserAgentContext): string {
  return ua
    .replace(`${context.appName}/${context.appVersion}`, '')
    .replace(`Electron/${context.electronVersion}`, '')
    .replace(/\s+/g, ' ')
    .trim()
}
