import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codecRefusalScript } from '../src/core/browser/hardwareCodecs.ts'
import { canDriveChrome, serveFixtures, type FixtureChrome } from './headlessChrome.ts'

// A codec the GPU cannot decode is not offered (#425): with AV1 refused, a
// page asking Media Source, a media element or mediaCapabilities about AV1
// hears no, and about VP9, H.264 or audio hears the browser's own answer.
//
// It needs a Chrome and a global WebSocket (Node ≥ 22); without either it is
// skipped, not failed. CHROME_PATH points it at a Chrome elsewhere.

const AV1 = 'video/mp4; codecs="av01.0.08M.08"'
const VP9 = 'video/webm; codecs="vp09.00.40.08"'
const H264 = 'video/mp4; codecs="avc1.640028"'
const AV1_WITH_OPUS = 'video/webm; codecs="av01.0.00M.08, opus"'
const OPUS = 'audio/webm; codecs="opus"'

describe.skipIf(!canDriveChrome)('a codec the GPU cannot decode is not offered (#425)', () => {
  let fixtures: FixtureChrome

  beforeAll(async () => {
    fixtures = await serveFixtures({ '/blank': '<body></body>' }, 'bingbong-codecs-chrome-')
  }, 60_000)

  afterAll(() => fixtures?.close())

  const answers = (): Promise<Record<string, unknown>> =>
    fixtures.chrome.evaluate(`(async () => {
      const types = ${JSON.stringify({ AV1, VP9, H264, AV1_WITH_OPUS, OPUS })}
      const out = {}
      for (const [name, type] of Object.entries(types)) {
        const video = type.startsWith('video/') ? { contentType: type, width: 1280, height: 720, bitrate: 2000000, framerate: 30 } : undefined
        const info = await navigator.mediaCapabilities.decodingInfo(video ? { type: 'media-source', video } : { type: 'media-source', audio: { contentType: type } })
        out[name] = [MediaSource.isTypeSupported(type), document.createElement('video').canPlayType(type) !== '', info.supported]
      }
      return out
    })()`) as Promise<Record<string, unknown>>

  it('refuses AV1 on every road a page asks by, and leaves every other answer the browser’s', async () => {
    await fixtures.open('/blank')
    const before = await answers()
    // This Chrome plays AV1 in software, so before the refusal it says yes.
    expect(before.AV1).toEqual([true, true, true])

    await fixtures.chrome.evaluate(codecRefusalScript(['av1']))
    const after = await answers()
    expect(after.AV1).toEqual([false, false, false])
    expect(after.AV1_WITH_OPUS).toEqual([false, false, false])
    expect(after.VP9).toEqual(before.VP9)
    expect(after.H264).toEqual(before.H264)
    expect(after.OPUS).toEqual(before.OPUS)
  })
})
