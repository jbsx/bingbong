import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MEDIA_TYPES_SCRIPT, PLAYBACK_SCRIPT } from '../src/main/perf/playbackScript.ts'
import type { PlaybackPoll } from '../src/core/perf/playbackTracker.ts'
import { canDriveChrome, serveFixtures, until, type FixtureChrome } from './headlessChrome.ts'

// The playback script (kiosk telemetry 2026-10-25): in a real Chrome, a
// media element asked to play is reported with its start, played time and
// stalls, and closed as ended when it ends; one never asked to play is not
// reported. By kind: a plain <audio> on a page that names no player.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

/** A second of silence as a 8 kHz mono 16-bit WAV, as a data URL. */
function silentWav(seconds: number): string {
  const rate = 8_000
  const samples = rate * seconds
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return `data:audio/wav;base64,${buffer.toString('base64')}`
}

describe.skipIf(!canDriveChrome)('the playback script hears a page\'s media by kind', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures({ '/song': '<body><audio id="song"></audio><audio id="idle"></audio></body>', '/stream': '<body><video id="clip" muted></video><video id="plain" muted></video></body>' }, 'bingbong-playback-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const poll = (): Promise<PlaybackPoll> => fixtures.chrome.evaluate(PLAYBACK_SCRIPT) as Promise<PlaybackPoll>

  it('reports media asked to play with its start, and closes it as ended; media never asked is not reported', async () => {
    await fixtures.open('/song')
    expect(await poll()).toEqual({ items: [], closed: [] })

    await fixtures.chrome.evaluate(`(() => {
      for (const el of document.querySelectorAll('audio')) el.src = ${JSON.stringify(silentWav(1))}
      document.getElementById('song').play()
    })()`)
    const playing = await until(async () => {
      const { items } = await poll()
      return items.length > 0 && items[0].startMs !== null ? items : null
    }, 'the song playing')
    expect(playing).toHaveLength(1)
    expect(playing[0]).toMatchObject({ kind: 'audio', page: expect.stringMatching(/\/song$/), stalls: 0, droppedFrames: null, height: null, codec: 'unknown' })
    expect(playing[0].startMs).toBeGreaterThanOrEqual(0)

    const ended = await until(async () => {
      const { closed } = await poll()
      return closed.length > 0 ? closed : null
    }, 'the song ending')
    expect(ended).toHaveLength(1)
    expect(ended[0]).toMatchObject({ kind: 'audio', closed: 'ended', key: playing[0].key })
    expect(ended[0].playedMs).toBeGreaterThan(500)
    expect(await poll()).toEqual({ items: [], closed: [] })
  })

  it('names the codecs a streaming page asked Media Source for, and follows changeType; unknown without the watch or a name (#425)', async () => {
    await fixtures.open('/stream')
    // The frame preload runs the watch before the page's first script; here it runs before the page's own media code.
    await fixtures.chrome.evaluate(MEDIA_TYPES_SCRIPT)
    expect(await poll()).toEqual({ items: [], closed: [] })
    await fixtures.chrome.evaluate(`(() => {
      const source = new MediaSource()
      const clip = document.getElementById('clip')
      clip.src = URL.createObjectURL(source)
      source.addEventListener('sourceopen', () => {
        const video = source.addSourceBuffer('video/webm; codecs="vp09.00.51.08"')
        source.addSourceBuffer('audio/webm; codecs="opus"')
        window.__videoBuffer = video
        // Asked to play once its load has started, as a player does.
        clip.play().catch(() => {})
      }, { once: true })
      const plain = document.getElementById('plain')
      plain.src = ${JSON.stringify(silentWav(5))}
      plain.addEventListener('loadstart', () => plain.play().catch(() => {}), { once: true })
    })()`)
    const named = await until(async () => {
      const { items } = await poll()
      const clip = items.find((item) => item.codec !== 'unknown')
      return clip !== undefined && items.length === 2 ? items : null
    }, 'both pieces of media reported')
    expect(named.map((item) => item.codec).sort()).toEqual(['unknown', 'vp09.00.51.08 / opus'])

    await fixtures.chrome.evaluate(`window.__videoBuffer.changeType('video/mp4; codecs="av01.0.08M.08"')`)
    const { items } = await poll()
    expect(items.map((item) => item.codec).sort()).toEqual(['av01.0.08M.08 / opus', 'unknown'])
  })
})
