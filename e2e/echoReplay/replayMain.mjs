// One kiosk replay in Electron (#512, #515): the take's monitor plays through WebAudio, so Chromium's echo canceller has
// it as its reference, into a sink no mic hears; the take's raw mic plays into the room's air, whose monitor is the mic.
// Each stream in the config is one getUserMedia with its flags, taken as micCapture.ts takes it, and saved whole.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const cfg = JSON.parse(fs.readFileSync(process.env.ECHO_REPLAY_CFG, 'utf8'))
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hidden = async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'blank.html'))
  return win
}

function wav(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

app.whenReady().then(async () => {
  try {
    const capture = await hidden()
    const play = await hidden()
    const settings = await capture.webContents.executeJavaScript(`(async () => {
      window.__streams = {}
      const settings = {}
      for (const { name, constraints } of ${JSON.stringify(cfg.streams)}) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
        const ctx = new AudioContext({ sampleRate: 16000, sinkId: { type: 'none' } })
        const source = ctx.createMediaStreamSource(stream)
        const proc = ctx.createScriptProcessor(1024, 1, 1)
        const chunks = []
        const stamps = []
        proc.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); stamps.push(Date.now()) }
        source.connect(proc)
        proc.connect(ctx.destination)
        window.__streams[name] = { chunks, stamps, stream, ctx, proc }
        settings[name] = stream.getAudioTracks()[0].getSettings()
      }
      return settings
    })()`)
    const b64 = fs.readFileSync(cfg.ref).toString('base64')
    await play.webContents.executeJavaScript(`(async () => {
      const bytes = Uint8Array.from(atob('${b64}'), (c) => c.charCodeAt(0))
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(bytes.buffer)
      window.__play = () => { const s = ctx.createBufferSource(); s.buffer = buffer; s.connect(ctx.destination); s.start(); return true }
      return true
    })()`)
    await sleep(1500)
    const wall = Date.now()
    await play.webContents.executeJavaScript('window.__play()')
    // The air always behind the reference, as a room's is: an echo that lands first has nothing to be cancelled from.
    await sleep(cfg.airLagMs)
    spawn('paplay', ['-s', cfg.server, `--device=${cfg.airSink}`, cfg.air], { stdio: 'ignore' })
    await sleep(cfg.totalMs)
    const meta = { settings, readWall: wall, streams: {} }
    for (const { name } of cfg.streams) {
      const dump = await capture.webContents.executeJavaScript(`(() => {
        const { chunks, stamps } = window.__streams[${JSON.stringify(name)}]
        const n = chunks.length * 1024
        const i16 = new Int16Array(n)
        chunks.forEach((chunk, c) => { for (let i = 0; i < 1024; i++) i16[c * 1024 + i] = Math.max(-32768, Math.min(32767, Math.round(chunk[i] * 32767))) })
        let s = ''
        const u8 = new Uint8Array(i16.buffer)
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
        return { pcm: btoa(s), firstStamp: stamps[0], lastStamp: stamps[stamps.length - 1], chunks: chunks.length }
      })()`)
      fs.writeFileSync(path.join(cfg.out, `${name}.wav`), wav(Buffer.from(dump.pcm, 'base64')))
      meta.streams[name] = { firstStamp: dump.firstStamp, lastStamp: dump.lastStamp, chunks: dump.chunks }
    }
    fs.writeFileSync(path.join(cfg.out, 'meta.json'), JSON.stringify(meta, null, 2))
  } catch (error) {
    console.error('replay failed', error)
    process.exitCode = 1
  }
  app.quit()
})
