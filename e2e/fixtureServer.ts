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
