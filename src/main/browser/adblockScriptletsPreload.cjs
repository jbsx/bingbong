// The browse partition's frame preload for scriptlets (see
// src/core/adblock/scriptlets.ts). Plain CommonJS with no imports: the pane
// is sandboxed, and a sandboxed preload must be one self-contained script.
// It runs before the document's first script, asks main for this page's
// scriptlets synchronously, and executes them in the page's main world —
// webFrame's injection is not subject to the page's CSP or Trusted Types.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a sandboxed preload has only require
const { ipcRenderer, webFrame } = require('electron')

// Kept in step with ADBLOCK_SCRIPTLETS_CHANNEL.
const CHANNEL = 'bingbong/adblock/scriptlets'

if (window === window.top && !location.href.startsWith('devtools://')) {
  const scripts = ipcRenderer.sendSync(CHANNEL, location.href)
  if (Array.isArray(scripts)) {
    for (const script of scripts) void webFrame.executeJavaScript(script).catch(() => {})
  }
}
