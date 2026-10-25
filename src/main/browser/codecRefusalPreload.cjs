// The browse partition's frame preload for the codec refusal (see
// src/core/browser/hardwareCodecs.ts). Plain CommonJS with no imports, as
// the adblock scriptlets' preload is: the pane is sandboxed. It runs in
// every frame — an embedded player asks too — before the document's first
// script, asks main for this machine's refusal synchronously, and runs it
// in the page's main world.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a sandboxed preload has only require
const { ipcRenderer, webFrame } = require('electron')

// Kept in step with CODEC_REFUSAL_CHANNEL.
const CHANNEL = 'bingbong/codecs/refusal'

if (!location.href.startsWith('devtools://')) {
  const script = ipcRenderer.sendSync(CHANNEL)
  if (typeof script === 'string' && script !== '') void webFrame.executeJavaScript(script).catch(() => {})
}
