import { createServer, type Server } from 'node:http'

export const DOWNLOAD_PAYLOAD = 'download-probe-payload'

export interface FixtureServer {
  url(path: string): string
  close(): Promise<void>
}

function page(body: string): string {
  return `<html><body style="background:#222">${body}</body></html>`
}

// Interactive elements the CDP controller e2e drives: buttons that record
// clicks via the title, an input/textarea/select/checkbox/video mix for
// snapshot coverage, and a below-the-fold button that only appears in the
// snapshot after scrolling (body is 3000px tall).
function interactivePage(): string {
  return `<!doctype html>
<html>
<head><title>interactive fixture</title></head>
<body style="background:#222;color:#fff;margin:0;height:3000px">
  <h1>interactive fixture page</h1>
  <button id="btn-hello" onclick="document.title='clicked:btn-hello'">Say hello</button>
  <a id="link-second" href="/second">Second page</a>
  <input id="q" placeholder="Type here" style="font-size:24px;width:320px">
  <textarea id="notes" placeholder="Notes"></textarea>
  <select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
  <input type="checkbox" id="agree">
  <video id="player" controls width="320" height="180" title="Fixture player"></video>
  <button id="btn-below" style="position:absolute;top:1600px" onclick="document.title='clicked:btn-below'">Below the fold</button>
</body>
</html>`
}

// Risk-gate fixture, in deterministic DOM order (refs are assigned in DOM
// order): [1] user [2] password [3] Sign in [4] card [5] Pay now [6] name
// [7] Send [8] Download probe. Submissions only record into the title.
function riskyPage(): string {
  return `<!doctype html>
<html>
<head><title>risky fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>risky fixture page</h1>
  <form onsubmit="document.title='submitted:login';return false">
    <input id="user" autocomplete="username" placeholder="Username" style="font-size:20px">
    <input id="pass" type="password" autocomplete="current-password" placeholder="Password" style="font-size:20px">
    <button style="font-size:20px">Sign in</button>
  </form>
  <form onsubmit="document.title='submitted:payment';return false">
    <input id="card" autocomplete="cc-number" placeholder="Card number" style="font-size:20px">
    <button style="font-size:20px">Pay now</button>
  </form>
  <form onsubmit="document.title='submitted:contact';return false">
    <input id="name" placeholder="Your name" style="font-size:20px">
    <button style="font-size:20px">Send</button>
  </form>
  <a href="/dl" download style="font-size:20px">Download probe</a>
</body>
</html>`
}

// Cookie-consent form shaped like consent.youtube.com: hidden inputs plus
// submit buttons whose only payload is the consent choice. Refs in DOM
// order: [1] Accept all [2] Reject all. Submissions record into the title.
function consentPage(): string {
  return `<!doctype html>
<html>
<head><title>consent fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>Before you continue</h1>
  <form onsubmit="document.title='submitted:consent';return false">
    <input type="hidden" name="continue" value="/">
    <button aria-label="Accept all" style="font-size:20px">Accept all</button>
    <button aria-label="Reject all" style="font-size:20px">Reject all</button>
  </form>
</body>
</html>`
}

// The www.youtube.com consent wall geometry: a fixed scrim over the page
// and a fixed role=dialog container whose consent buttons sit far below the
// fold inside the dialog's own scroller. Page elements stay rect-visible but
// are covered, so the click path must activate them directly; the dialog's
// buttons must be listed (dialog layer) even though they are off-screen.
function consentWallPage(): string {
  return `<!doctype html>
<html>
<head><title>consent wall fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>page behind a consent wall</h1>
  <button id="btn-bg" onclick="document.title='clicked:btn-bg'" style="font-size:20px">Background button</button>
  <a href="/second" style="font-size:20px">Background link</a>
  <div style="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100"></div>
  <div role="dialog" aria-modal="true" style="position:fixed;inset:0;overflow:auto;background:#333;z-index:101;padding:24px">
    <h2>Before you continue to this fixture</h2>
    <div style="height:2000px"></div>
    <form onsubmit="document.title='submitted:consent';return false">
      <input type="hidden" name="continue" value="/">
      <button aria-label="Accept all" style="font-size:20px">Accept all</button>
      <button aria-label="Reject all" style="font-size:20px">Reject all</button>
    </form>
  </div>
</body>
</html>`
}

// Media-verb fixture: a page that records every keydown it receives, so the
// e2e can assert the exact trusted key events media_control injects (keys,
// shift state) without depending on a real video provider.
function mediaPage(): string {
  return `<!doctype html>
<html>
<head><title>media fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>media fixture page</h1>
  <video controls width="320" height="180" title="Fixture player"></video>
  <script>
    window.__pressedKeys = []
    document.addEventListener('keydown', (e) => {
      window.__pressedKeys.push({ key: e.key, shift: e.shiftKey })
    })
  </script>
</body>
</html>`
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const httpServer: Server = createServer((req, res) => {
    if (req.url === '/dl') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="probe.bin"',
      })
      res.end(DOWNLOAD_PAYLOAD)
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (req.url === '/second') {
      res.end(page('<h1 style="color:#fff">second fixture page</h1>'))
      return
    }
    if (req.url === '/interactive') {
      res.end(interactivePage())
      return
    }
    if (req.url === '/risky') {
      res.end(riskyPage())
      return
    }
    if (req.url === '/consent') {
      res.end(consentPage())
      return
    }
    if (req.url === '/consent-wall') {
      res.end(consentWallPage())
      return
    }
    if (req.url === '/media') {
      res.end(mediaPage())
      return
    }
    res.end(page('<input id=t style="font-size:40px;width:100%;height:120px">'))
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server has no port')

  return {
    url: (path) => `http://127.0.0.1:${address.port}${path}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
