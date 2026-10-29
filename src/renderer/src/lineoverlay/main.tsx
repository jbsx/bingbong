import React from 'react'
import { createRoot } from 'react-dom/client'
import { LineOverlay, useOverlayLine } from '../LineOverlay'
import { installRendererDiagnostics } from '../diagnostics'

// The Line Overlay's own view over the browsing pane (#513, main's
// attachPopupView): the page is the overlay and nothing else, filling the
// view, which main sizes to the dashboard's Line Overlay slot while a line
// is up. It folds the line from the pipeline stream main sends it.
installRendererDiagnostics('lineoverlay')

function LineOverlayView() {
  const line = useOverlayLine()
  return line !== null ? <LineOverlay line={line} /> : null
}

createRoot(document.getElementById('lineoverlay-root')!).render(
  <React.StrictMode>
    <LineOverlayView />
  </React.StrictMode>,
)
