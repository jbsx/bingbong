import React from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayPanel } from './OverlayPanel'

createRoot(document.getElementById('overlay-root')!).render(
  <React.StrictMode>
    <OverlayPanel />
  </React.StrictMode>,
)
