import { applyAuthHostHeaders, isAuthUrl, type AuthIdentity } from '../../core/browser/authIdentity'

// Session-level identity rewrite (ADR 0018): requests to auth hosts carry
// the simplified UA and no Chromium client hints. Registered once per
// browse partition — every view on the partition (main pane, subagent tabs,
// auth popups) is covered from its first request.
//
// `refresh()` re-asserts the listener: disabling the adblocker clears every
// webRequest listener on the session (see attachAdblock), and this rewrite
// must survive that swap.

export interface IdentityHeadersAttachment {
  /** Re-register the listener after another component cleared it. */
  refresh(): void
}

export function attachIdentityHeaders(
  session: Electron.Session,
  identity: AuthIdentity,
): IdentityHeadersAttachment {
  const register = (): void => {
    if (session.webRequest.onBeforeSendHeaders == null) return
    session.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const headers = { ...details.requestHeaders }
      callback({
        requestHeaders: isAuthUrl(details.url, identity.hosts)
          ? applyAuthHostHeaders(headers, identity.userAgent)
          : headers,
      })
    })
  }

  register()
  return { refresh: register }
}
