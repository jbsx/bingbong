// A video codec the GPU cannot decode is not offered to a page (#425): a
// site picks its codec by asking the browser what it plays, and YouTube,
// told AV1 plays, serves AV1 to the kiosk, whose Kaby Lake decodes VP9 and
// H.264 but not AV1 — every song then decoded on the CPU. So while the GPU
// decodes some codec, the pane answers "no" for each it does not, and the
// site serves one it does. By kind: every codec, every site, every frame;
// the GPU's own answer (mediaCapabilities' powerEfficient) is the fact. A
// machine that decodes nothing in hardware refuses nothing: every codec is
// software there alike.

export type CodecFamily = 'av1' | 'vp9' | 'vp8' | 'h264' | 'hevc'

/** Frame preload → main, synchronous: the refusal script for this machine, '' while none (or nothing is refused). */
export const CODEC_REFUSAL_CHANNEL = 'bingbong/codecs/refusal'

/** The leading part of a codec string (RFC 6381, as a page asks) and its family. */
const CODEC_PREFIXES: readonly (readonly [string, CodecFamily])[] = [
  ['av01', 'av1'],
  ['vp09', 'vp9'],
  ['vp9', 'vp9'],
  ['vp08', 'vp8'],
  ['vp8', 'vp8'],
  ['avc1', 'h264'],
  ['avc3', 'h264'],
  ['hvc1', 'hevc'],
  ['hev1', 'hevc'],
]

/** What the GPU is asked about each family: a 1080p stream as a site plays it through Media Source. */
export const CODEC_PROBES: Readonly<Record<CodecFamily, string>> = {
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  vp9: 'video/webm; codecs="vp09.00.40.08"',
  vp8: 'video/webm; codecs="vp8"',
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
}

export function codecFamilyOf(codec: string): CodecFamily | null {
  const name = codec.trim().toLowerCase()
  return CODEC_PREFIXES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null
}

/** Whether a probe's answer is one boolean per family. */
export function isCodecProbeResult(value: unknown): value is Record<CodecFamily, boolean> {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<string, unknown>
  return (Object.keys(CODEC_PROBES) as CodecFamily[]).every((family) => typeof result[family] === 'boolean')
}

/** The families a page is refused, given which the GPU decodes: those it does not, while it decodes any. */
export function refusedCodecs(inHardware: Readonly<Record<CodecFamily, boolean>>): CodecFamily[] {
  const families = Object.keys(inHardware) as CodecFamily[]
  if (!families.some((family) => inHardware[family])) return []
  return families.filter((family) => !inHardware[family])
}

/** Asks the page's own mediaCapabilities which families decode power-efficiently, i.e. on the GPU; evaluated in a page. */
export function codecProbeScript(): string {
  return `(async () => {
  const probes = ${JSON.stringify(CODEC_PROBES)}
  const out = {}
  for (const [family, contentType] of Object.entries(probes)) {
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType, width: 1920, height: 1080, bitrate: 4000000, framerate: 30 } })
      out[family] = info.supported === true && info.powerEfficient === true
    } catch {
      out[family] = false
    }
  }
  return out
})()`
}

/**
 * The page's main world, before its first script: a type naming a refused
 * codec is not supported by Media Source, cannot be played, and decodes
 * nowhere. Every other answer is the browser's own.
 */
export function codecRefusalScript(refused: readonly CodecFamily[]): string {
  return `(() => {
  const refused = new Set(${JSON.stringify(refused)})
  const prefixes = ${JSON.stringify(CODEC_PREFIXES)}
  const familyOf = (codec) => {
    const name = codec.trim().toLowerCase()
    const hit = prefixes.find(([prefix]) => name.startsWith(prefix))
    return hit ? hit[1] : null
  }
  const refuses = (type) => {
    if (typeof type !== 'string') return false
    const codecs = /codecs\\s*=\\s*"?([^";]*)"?/i.exec(type)
    return codecs !== null && codecs[1].split(',').some((codec) => refused.has(familyOf(codec)))
  }
  for (const source of [window.MediaSource, window.ManagedMediaSource]) {
    if (!source || typeof source.isTypeSupported !== 'function') continue
    const isTypeSupported = source.isTypeSupported.bind(source)
    Object.defineProperty(source, 'isTypeSupported', { configurable: true, writable: true, value: (type) => (refuses(type) ? false : isTypeSupported(type)) })
  }
  const canPlayType = HTMLMediaElement.prototype.canPlayType
  HTMLMediaElement.prototype.canPlayType = function (type) {
    return refuses(type) ? '' : canPlayType.call(this, type)
  }
  if (window.MediaCapabilities) {
    const decodingInfo = MediaCapabilities.prototype.decodingInfo
    MediaCapabilities.prototype.decodingInfo = function (config) {
      if (config && config.video && refuses(config.video.contentType)) return Promise.resolve({ supported: false, smooth: false, powerEfficient: false })
      return decodingInfo.call(this, config)
    }
  }
})()`
}
