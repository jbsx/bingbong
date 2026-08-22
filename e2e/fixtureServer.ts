import { createServer, type Server } from 'node:http'

export const DOWNLOAD_PAYLOAD = 'download-probe-payload'

/** 1x1 transparent PNG — the ad/ok assets differ only by URL. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// EasyList-syntax list for the adblocker e2e: two network filters (a banner
// path and a tracker script) plus a generic cosmetic filter. The app fetches
// this from BINGBONG_ADBLOCK_LISTS, so the engine is exercised offline.
const ADBLOCK_LIST_BODY = [
  '! Title: bingbong e2e blocklist',
  '/ad-banner.png',
  '/tracker.js',
  '##.ad-slot',
  '',
].join('\n')

// The page under test: a blocked banner image, an allowed image, a blocked
// tracker script and a cosmetic ad slot. Asset outcomes land in
// window.__assets so probes don't depend on naturalWidth heuristics.
function adblockPage(): string {
  return `<!doctype html>
<html>
<head><title>adblock fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>adblock fixture page</h1>
  <div class="ad-slot" id="ad-slot">Sponsored content</div>
  <script>
    window.__gen = Math.random()
    window.__assets = { ad: 'pending', ok: 'pending' }
    const addImg = (id, src, key) => {
      const el = document.createElement('img')
      el.id = id
      el.onload = () => { window.__assets[key] = 'loaded' }
      el.onerror = () => { window.__assets[key] = 'error' }
      el.src = src
      document.body.appendChild(el)
    }
    addImg('ad-img', '/ad-banner.png', 'ad')
    addImg('ok-img', '/ok-asset.png', 'ok')
  </script>
  <script src="/tracker.js"></script>
</body>
</html>`
}

export interface FixtureServer {
  url(path: string): string
  /** How many times the adblock filter list has been fetched (cache probes). */
  adblockListHits(): number
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
  <button id="btn-noop">Do nothing</button>
  <button id="btn-dialog" onclick="if(!document.getElementById('opened-dialog')){const replacement=this.cloneNode(true);replacement.setAttribute('aria-pressed','true');this.replaceWith(replacement);const dialog=document.createElement('div');dialog.id='opened-dialog';dialog.setAttribute('role','dialog');dialog.textContent='Opened dialog';dialog.style.cssText='position:fixed;inset:100px;background:#444';document.body.appendChild(dialog)}">Open dialog</button>
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
// fold inside the dialog's own scroller. Submitting the form dismisses the
// wall (like real consent walls do). Refs in DOM order: [1] Accept all
// [2] Reject all [3] Background button.
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
    <form onsubmit="document.title='submitted:consent';this.closest('[role=dialog]').remove();return false">
      <input type="hidden" name="continue" value="/">
      <button aria-label="Accept all" style="font-size:20px">Accept all</button>
      <button aria-label="Reject all" style="font-size:20px">Reject all</button>
    </form>
  </div>
</body>
</html>`
}

// A Tier-2 wall: no consent labels anywhere, so nothing is auto-dismissable.
// The dialog's text + controls must reach the model, and "Not now" must be
// clickable through real input.
// Refs in DOM order: [1] Sign in [2] Not now [3] Background button.
function dialogWallPage(): string {
  return `<!doctype html>
<html>
<head><title>dialog wall fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>page behind a sign-in wall</h1>
  <button id="btn-bg2" onclick="document.title='clicked:btn-bg2'" style="font-size:20px">Background button</button>
  <div style="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100"></div>
  <div role="dialog" aria-modal="true" style="position:fixed;inset:0;overflow:auto;background:#333;z-index:101;padding:24px">
    <h2>Sign in to continue to this fixture</h2>
    <div style="height:24px"></div>
    <button id="btn-signin" onclick="document.title='clicked:signin'" style="font-size:20px">Sign in</button>
    <button id="btn-notnow" onclick="document.title='clicked:notnow';this.closest('[role=dialog]').remove()" style="font-size:20px">Not now</button>
  </div>
</body>
</html>`
}

// Native JS dialogs: alert/confirm block the renderer until CDP answers.
// Buttons record what happened after the dialog was auto-dismissed.
// Refs in DOM order: [1] Show alert [2] Ask confirm [3] Leave page link.
function nativeDialogPage(): string {
  return `<!doctype html>
<html>
<head><title>native dialog fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>native dialog fixture page</h1>
  <button id="btn-alert" style="font-size:20px" onclick="window.__alertShown = true; alert('native hello'); window.__alertAfter = true">Show alert</button>
  <button id="btn-confirm" style="font-size:20px" onclick="window.__confirmAnswer = confirm('really proceed?')">Ask confirm</button>
  <a id="link-leave" href="/second" style="font-size:20px">Leave page</a>
</body>
</html>`
}

// A real beforeunload prompt. Dismissing it with accept=false keeps the page
// in place; the controller reports the native dialog to the model.
function beforeUnloadPage(): string {
  return `<!doctype html>
<html>
<head><title>beforeunload fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>beforeunload fixture page</h1>
  <a id="link-leave" href="/second" style="font-size:20px">Leave with unsaved work</a>
  <script>window.onbeforeunload = () => 'unsaved work'</script>
</body>
</html>`
}

// window.open popup: denied at open by the pane, URL reported to the model.
// Refs in DOM order: [1] Open popup.
function popupPage(): string {
  return `<!doctype html>
<html>
<head><title>popup fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>popup fixture page</h1>
  <button id="btn-open" style="font-size:20px" onclick="window.__popup = window.open('/second'); document.title='clicked:open'">Open popup</button>
</body>
</html>`
}

// A plain overlay (no dialog semantics) covering a button: the click must be
// reported as blocked, not clicked through. Refs: [1] Under the overlay.
function overlayPage(): string {
  return `<!doctype html>
<html>
<head><title>overlay fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>overlay fixture page</h1>
  <button id="btn-under" onclick="document.title='clicked:btn-under'" style="font-size:20px">Under the overlay</button>
  <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50"></div>
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

// Vision-grounding fixture: the play affordance is intentionally an
// unlabeled div with no interactive role, so the DOM collector cannot expose
// it. Only screenshot grounding can register it as a temporary ref.
function visualTargetPage(): string {
  return `<!doctype html>
<html>
<head><title>visual target fixture</title></head>
<body style="background:#111;color:#fff;margin:0">
  <h1 style="margin:24px">Featured video</h1>
  <div style="position:fixed;left:240px;top:160px;width:320px;height:180px;background:linear-gradient(135deg,#a82d3d,#31142c);box-shadow:0 20px 60px #000">
    <div id="visual-play" onclick="document.title='clicked:visual-play'" style="position:absolute;left:110px;top:45px;width:100px;height:90px;border-radius:50%;background:rgba(255,255,255,.92);cursor:pointer">
      <span style="position:absolute;left:41px;top:27px;width:0;height:0;border-top:18px solid transparent;border-bottom:18px solid transparent;border-left:28px solid #8f2337"></span>
    </div>
  </div>
</body>
</html>`
}

// Blocker-visibility fixture (ADR 0007): a Turnstile-shaped challenge
// iframe whose src host is what matters — the collector reads the element
// attribute, so the widget is listed even though its content never loads
// offline. The same-origin and srcless iframes are decoys that must NOT
// become refs. Refs in DOM order: [1] iframe (challenge) [2] Continue.
function challengePage(): string {
  return `<!doctype html>
<html>
<head><title>challenge fixture</title></head>
<body style="background:#222;color:#fff;margin:0">
  <h1>challenge fixture page</h1>
  <p>Verifying you are human. This may take a few seconds.</p>
  <iframe title="Widget containing a Cloudflare security challenge" src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile" width="300" height="65" style="border:1px solid #555"></iframe>
  <iframe title="same-origin embed" src="/second" width="10" height="10"></iframe>
  <iframe title="srcless embed" width="10" height="10"></iframe>
  <button id="btn-continue" style="font-size:20px">Continue</button>
</body>
</html>`
}

export async function startFixtureServer(): Promise<FixtureServer> {
  let adblockListHits = 0
  const httpServer: Server = createServer((req, res) => {
    if (req.url === '/dl') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="probe.bin"',
      })
      res.end(DOWNLOAD_PAYLOAD)
      return
    }
    if (req.url === '/ad-banner.png' || req.url === '/ok-asset.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(PIXEL_PNG)
      return
    }
    if (req.url === '/tracker.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end('window.__trackerRan = true\n')
      return
    }
    if (req.url === '/adblock-list') {
      adblockListHits += 1
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(ADBLOCK_LIST_BODY)
      return
    }
    if (req.url === '/slow') {
      setTimeout(() => {
        if (res.destroyed) return
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(page('<h1 style="color:#fff">slow fixture page</h1>'))
      }, 3_000)
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
    if (req.url === '/dialog-wall') {
      res.end(dialogWallPage())
      return
    }
    if (req.url === '/challenge') {
      res.end(challengePage())
      return
    }
    if (req.url === '/native-dialog') {
      res.end(nativeDialogPage())
      return
    }
    if (req.url === '/beforeunload') {
      res.end(beforeUnloadPage())
      return
    }
    if (req.url === '/popup') {
      res.end(popupPage())
      return
    }
    if (req.url === '/overlay') {
      res.end(overlayPage())
      return
    }
    if (req.url === '/media') {
      res.end(mediaPage())
      return
    }
    if (req.url === '/visual-target') {
      res.end(visualTargetPage())
      return
    }
    if (req.url === '/adblock') {
      res.end(adblockPage())
      return
    }
    res.end(page('<input id=t style="font-size:40px;width:100%;height:120px">'))
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server has no port')

  return {
    url: (path) => `http://127.0.0.1:${address.port}${path}`,
    adblockListHits: () => adblockListHits,
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
