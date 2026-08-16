import { createServer, type Server } from 'node:http'

export const DOWNLOAD_PAYLOAD = 'download-probe-payload'

export interface FixtureServer {
  url(path: string): string
  close(): Promise<void>
}

function page(body: string): string {
  return `<html><body style="background:#222">${body}</body></html>`
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
