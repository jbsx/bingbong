import React from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayPanel } from './OverlayPanel'
import { installRendererDiagnostics } from '../diagnostics'

// The panel page reports as its own surface (#187): the two pages fail,
// clear and re-adopt independently, and a record that could not tell them
// apart would answer neither.
installRendererDiagnostics('feed_panel')

createRoot(document.getElementById('overlay-root')!).render(
  <React.StrictMode>
    <OverlayPanel />
  </React.StrictMode>,
)
