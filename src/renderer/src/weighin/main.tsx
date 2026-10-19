import React from 'react'
import { createRoot } from 'react-dom/client'
import { WeighInPopup } from '../WeighInPopup'
import { useWeighInPopup } from '../useWeight'
import { installRendererDiagnostics } from '../diagnostics'

// The Weigh-in pop-up's own view over the browsing pane (main's
// attachWeighInView): the page is the pop-up and nothing else, filling the
// view, which main sizes to the Peek Card's place while it shows.
installRendererDiagnostics('weighin')

function WeighInView() {
  return <WeighInPopup state={useWeighInPopup()} />
}

createRoot(document.getElementById('weighin-root')!).render(
  <React.StrictMode>
    <WeighInView />
  </React.StrictMode>,
)
