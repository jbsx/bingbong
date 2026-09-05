import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installRendererDiagnostics } from './diagnostics'

// Before the first render (#187): an unhandled failure during mount is
// exactly the one worth a record, and there is no page state to wait for.
installRendererDiagnostics('dashboard')

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
