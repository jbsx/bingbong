// A video codec the GPU cannot decode is not offered to a page (#425): a
// site picks its codec by asking the browser what it plays, and YouTube,
// told AV1 plays, serves AV1 to the kiosk, whose Kaby Lake decodes VP9 and
// H.264 but not AV1 — every song then decoded on the CPU. So while the GPU
// decodes some codec, the pane answers "no" for each it does not, and the
// site serves one it does. By kind: every codec, every site, every frame;
// the GPU's own answer (mediaCapabilities' powerEfficient) is the fact. A
// machine that decodes nothing in hardware refuses nothing: every codec is
// software there alike.

import type { Clock } from '../ports/clock'

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

/**
 * How long each step of the probe may take before it is reported unsettled:
 * the probe page's load, and the GPU's decodingInfo answer. A guess (#425,
 * 2026-10-26): on the dev PC the whole probe settles in about 150 ms; a
 * kiosk boot that has the step legitimately slower than this would show as
 * an `unsettled` line followed by a late answer, and would settle it.
 */
export const CODEC_PROBE_BOUND_MS = 5_000

/** What a family's decodingInfo is answered with when it gave no answer inside the bound. */
export const CODEC_PROBE_HUNG = 'hung'

/**
 * Asks the page's own mediaCapabilities which families decode
 * power-efficiently, i.e. on the GPU; evaluated in a page. Every family is
 * asked at once, and one whose answer is not in by `boundMs` is answered
 * {@link CODEC_PROBE_HUNG}, so the script itself always settles.
 */
export function codecProbeScript(boundMs: number = CODEC_PROBE_BOUND_MS): string {
  return `(async () => {
  const probes = ${JSON.stringify(CODEC_PROBES)}
  const hung = new Promise((resolve) => setTimeout(() => resolve(${JSON.stringify(CODEC_PROBE_HUNG)}), ${boundMs}))
  const ask = async (contentType) => {
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType, width: 1920, height: 1080, bitrate: 4000000, framerate: 30 } })
      return info.supported === true && info.powerEfficient === true
    } catch {
      return false
    }
  }
  const families = Object.keys(probes)
  const answers = await Promise.all(families.map((family) => Promise.race([ask(probes[family]), hung])))
  return Object.fromEntries(families.map((family, i) => [family, answers[i]]))
})()`
}

/** The step of the probe that did not settle: the page never loaded, the page never ran the script, or the GPU never answered. */
export type CodecProbeStep = 'load' | 'evaluate' | 'decodingInfo'

export type CodecProbeEvent =
  | { kind: 'answer'; inHardware: Record<CodecFamily, boolean>; refused: CodecFamily[]; ms: number }
  | { kind: 'unsettled'; step: CodecProbeStep; message: string; ms: number }

export interface CodecProbeDeps {
  /** Resolves once the probe page has loaded (at once when it has). */
  loaded(): Promise<void>
  /** Evaluates {@link codecProbeScript} in the probe page. */
  evaluate(): Promise<unknown>
  clock: Clock
  boundMs?: number
}

/**
 * Runs the probe so that it always says something: an `answer`, or an
 * `unsettled` event naming the step that did not finish inside its bound.
 * An unsettled step refuses nothing (every codec stays offered, as with no
 * probe at all). A page that loads, or runs the script, after its bound
 * still has its answer emitted, so a slow boot arms the refusal late rather
 * than never; a family the GPU never answered refuses nothing for good.
 */
export function runCodecProbe(deps: CodecProbeDeps, emit: (event: CodecProbeEvent) => void): void {
  const bound = deps.boundMs ?? CODEC_PROBE_BOUND_MS
  const start = deps.clock.now()
  const since = (): number => deps.clock.now() - start
  const unsettled = (step: CodecProbeStep, message: string): void => emit({ kind: 'unsettled', step, message, ms: since() })
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

  let loadSettled = false
  const cancelLoad = deps.clock.setTimer(bound, () => {
    if (!loadSettled) unsettled('load', `the probe page did not finish loading in ${bound} ms`)
  })
  deps.loaded().then(
    () => {
      loadSettled = true
      cancelLoad()
      let evaluated = false
      // The script bounds its own decodingInfo calls; past twice that, the page itself never ran it.
      const cancelEvaluate = deps.clock.setTimer(2 * bound, () => {
        if (!evaluated) unsettled('evaluate', `the page did not run the probe script in ${2 * bound} ms`)
      })
      deps.evaluate().then(
        (value) => {
          evaluated = true
          cancelEvaluate()
          if (typeof value === 'object' && value !== null) {
            const hung = Object.entries(value as Record<string, unknown>).flatMap(([family, answer]) => (answer === CODEC_PROBE_HUNG ? [family] : []))
            if (hung.length > 0) {
              unsettled('decodingInfo', `mediaCapabilities.decodingInfo did not answer for ${hung.join(', ')} in ${bound} ms`)
              return
            }
          }
          if (!isCodecProbeResult(value)) {
            unsettled('evaluate', `unreadable probe: ${JSON.stringify(value)}`)
            return
          }
          emit({ kind: 'answer', inHardware: value, refused: refusedCodecs(value), ms: since() })
        },
        (error: unknown) => {
          evaluated = true
          cancelEvaluate()
          unsettled('evaluate', message(error))
        },
      )
    },
    (error: unknown) => {
      loadSettled = true
      cancelLoad()
      unsettled('load', message(error))
    },
  )
}

/** The probe's one journal line: what the GPU decodes and what pages are refused, or which step did not settle. */
export function codecProbeLine(event: CodecProbeEvent): string {
  if (event.kind === 'unsettled') return `[codecs] probe unsettled at ${event.step} after ${event.ms} ms: ${event.message}; refused to pages: none`
  const decoded = (Object.keys(event.inHardware) as CodecFamily[]).filter((family) => event.inHardware[family])
  return `[codecs] decoded on the GPU: ${decoded.join(', ') || 'none'}; refused to pages: ${event.refused.join(', ') || 'none'} (probe ${event.ms} ms)`
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
