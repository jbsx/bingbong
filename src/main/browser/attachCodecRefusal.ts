import { ipcMain, type IpcMainEvent, type Session, type WebContents } from 'electron'
import { CODEC_PROBES, CODEC_REFUSAL_CHANNEL, codecProbeLine, codecProbeScript, codecRefusalScript, refusedCodecs, runCodecProbe, type CodecFamily, type CodecProbeEvent } from '../../core/browser/hardwareCodecs'
import { systemClock } from '../../core/ports/clock'
import { MEDIA_TYPES_SCRIPT } from '../perf/playbackScript'
import { reportFault } from '../../core/trace/fault'
import codecRefusalPreloadPath from './codecRefusalPreload.cjs?asset'

// The codec refusal, main wiring (#425; the rule is core/browser/
// hardwareCodecs): the GPU is asked once, in the pane's blank start page,
// which families it decodes; every frame of the partition then asks here
// before its first script and is handed the refusal. A frame that asks
// before the answer is in is refused nothing. The probe always says what
// happened (2026-10-26: on the kiosk it said nothing for two boots): its
// answer, or the step that did not settle within its bound, as a journal
// line and a fault. Every frame is also handed the media-types watch, which
// lets the playback record name the codec a page chose (by kind: what it
// asked Media Source for). The settle is also handed to `onSettled`, which
// marks it in the perf log: the journal is not the only record (2026-10-26:
// the line was there all along, but Chromium moves the main process into its
// own `app-<name>-<pid>.scope`, so `journalctl --user -u bingbong` never
// showed it).

/** The e2e's stand-in for the GPU (Xvfb has none): the families it decodes, comma-separated, in place of the probe. */
export const GPU_CODECS_ENV = 'BINGBONG_GPU_CODECS'

function standInAnswer(list: string): Record<CodecFamily, boolean> {
  const decoded = new Set(list.split(',').map((family) => family.trim()))
  return Object.fromEntries((Object.keys(CODEC_PROBES) as CodecFamily[]).map((family) => [family, decoded.has(family)])) as Record<CodecFamily, boolean>
}

export interface CodecRefusalOptions {
  env?: Record<string, string | undefined>
  /** Told once, when the probe settles: its answer, or the step that did not. */
  onSettled?: (event: CodecProbeEvent) => void
}

/** Registers the refusal on the pane's session and asks the GPU in `probe` (the pane, on its blank start page); the returned release undoes it. */
export function attachCodecRefusal(paneSession: Session, probe: WebContents, { env = process.env, onSettled }: CodecRefusalOptions = {}): () => void {
  let script = ''
  const preload = paneSession.registerPreloadScript({ type: 'frame', filePath: codecRefusalPreloadPath })
  // The reply must always be set, or the frame's renderer waits on it.
  const onAsk = (event: IpcMainEvent): void => {
    event.returnValue = event.sender.session === paneSession ? `${MEDIA_TYPES_SCRIPT};\n${script}` : ''
  }
  ipcMain.on(CODEC_REFUSAL_CHANNEL, onAsk)

  const settle = (event: CodecProbeEvent): void => {
    console.log(codecProbeLine(event))
    if (event.kind === 'answer') script = event.refused.length > 0 ? codecRefusalScript(event.refused) : ''
    // No answer refuses nothing: every codec stays offered, as before.
    else reportFault('browser.attachCodecRefusal.probe', new Error(`${event.step}: ${event.message}`))
    onSettled?.(event)
  }
  const standIn = env[GPU_CODECS_ENV]
  if (standIn !== undefined) {
    const inHardware = standInAnswer(standIn)
    settle({ kind: 'answer', inHardware, refused: refusedCodecs(inHardware), ms: 0 })
  } else {
    runCodecProbe(
      {
        // A load that fails or is cut short still stops loading: either edge lets the probe ask.
        loaded: () =>
          probe.isLoading()
            ? new Promise<void>((resolve) => {
                const done = (): void => {
                  probe.removeListener('did-finish-load', done)
                  probe.removeListener('did-stop-loading', done)
                  resolve()
                }
                probe.on('did-finish-load', done)
                probe.on('did-stop-loading', done)
              })
            : Promise.resolve(),
        evaluate: () => probe.executeJavaScript(codecProbeScript()),
        clock: systemClock,
      },
      settle,
    )
  }

  return () => {
    ipcMain.removeListener(CODEC_REFUSAL_CHANNEL, onAsk)
    paneSession.unregisterPreloadScript(preload)
  }
}
