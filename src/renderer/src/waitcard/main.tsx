import React from 'react'
import { createRoot } from 'react-dom/client'
import { WaitCard, useSongWait } from '../WaitCard'
import { installRendererDiagnostics } from '../diagnostics'

// The Wait Card's own view over the browsing pane (#507, main's
// attachPopupView): the page is the card and nothing else, filling the
// view, which main sizes to the dashboard's Wait Card slot while a song
// waits. It folds the wait from the pipeline stream main sends it.
installRendererDiagnostics('waitcard')

function WaitCardView() {
  const wait = useSongWait()
  return wait !== null ? <WaitCard wait={wait} /> : null
}

createRoot(document.getElementById('waitcard-root')!).render(
  <React.StrictMode>
    <WaitCardView />
  </React.StrictMode>,
)
