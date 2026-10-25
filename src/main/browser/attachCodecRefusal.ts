import { ipcMain, type IpcMainEvent, type Session, type WebContents } from 'electron'
import { CODEC_PROBES, CODEC_REFUSAL_CHANNEL, codecProbeScript, codecRefusalScript, isCodecProbeResult, refusedCodecs, type CodecFamily } from '../../core/browser/hardwareCodecs'
import { reportFault } from '../../core/trace/fault'
import codecRefusalPreloadPath from './codecRefusalPreload.cjs?asset'

// The codec refusal, main wiring (#425; the rule is core/browser/
// hardwareCodecs): the GPU is asked once, in the pane's blank start page,
// which families it decodes; every frame of the partition then asks here
// before its first script and is handed the refusal. A frame that asks
// before the answer is in is refused nothing.

/** The e2e's stand-in for the GPU (Xvfb has none): the families it decodes, comma-separated, in place of the probe. */
export const GPU_CODECS_ENV = 'BINGBONG_GPU_CODECS'

function standInAnswer(list: string): Record<CodecFamily, boolean> {
  const decoded = new Set(list.split(',').map((family) => family.trim()))
  return Object.fromEntries((Object.keys(CODEC_PROBES) as CodecFamily[]).map((family) => [family, decoded.has(family)])) as Record<CodecFamily, boolean>
}

/** Registers the refusal on the pane's session and asks the GPU in `probe` (the pane, on its blank start page); the returned release undoes it. */
export function attachCodecRefusal(paneSession: Session, probe: WebContents, env: Record<string, string | undefined> = process.env): () => void {
  let script = ''
  const preload = paneSession.registerPreloadScript({ type: 'frame', filePath: codecRefusalPreloadPath })
  // The reply must always be set, or the frame's renderer waits on it.
  const onAsk = (event: IpcMainEvent): void => {
    event.returnValue = event.sender.session === paneSession ? script : ''
  }
  ipcMain.on(CODEC_REFUSAL_CHANNEL, onAsk)

  const ask = async (): Promise<void> => {
    try {
      const standIn = env[GPU_CODECS_ENV]
      const inHardware: unknown = standIn !== undefined ? standInAnswer(standIn) : await probe.executeJavaScript(codecProbeScript())
      if (!isCodecProbeResult(inHardware)) throw new Error(`unreadable probe: ${JSON.stringify(inHardware)}`)
      const refused = refusedCodecs(inHardware)
      script = refused.length > 0 ? codecRefusalScript(refused) : ''
      const decoded = Object.entries(inHardware).flatMap(([family, yes]) => (yes ? [family] : []))
      console.log(`[codecs] decoded on the GPU: ${decoded.join(', ') || 'none'}; refused to pages: ${refused.join(', ') || 'none'}`)
    } catch (error) {
      // No answer refuses nothing: every codec stays offered, as before.
      reportFault('browser.attachCodecRefusal.probe', error)
    }
  }
  if (probe.isLoading()) probe.once('did-finish-load', () => void ask())
  else void ask()

  return () => {
    ipcMain.removeListener(CODEC_REFUSAL_CHANNEL, onAsk)
    paneSession.unregisterPreloadScript(preload)
  }
}
