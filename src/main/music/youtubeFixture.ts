import { net, type Session } from 'electron'

// The e2e's stand-in for YouTube (#344, e2e/idleMusic.e2e.test.ts): with
// BINGBONG_YOUTUBE_FIXTURE set to a local server's origin, the pane's
// requests to www.youtube.com are answered from that server under
// YouTube's own addresses, so the Player runs its real road against a
// page the test controls. Every other https request goes out as usual.
// Test support only: nothing sets the variable outside the e2e harness.

export const YOUTUBE_FIXTURE_ENV = 'BINGBONG_YOUTUBE_FIXTURE'

export function routeYouTubeToFixture(session: Session, origin: string): void {
  session.protocol.handle('https', (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'www.youtube.com') return net.fetch(`${origin}${url.pathname}${url.search}`)
    return net.fetch(request, { bypassCustomProtocolHandlers: true })
  })
}
