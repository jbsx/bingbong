import { useState } from 'react'
import { BrowserPane } from './BrowserPane'
import { AssistantPanel, StatusOrb } from './AssistantPanel'
import { SettingsPage } from './SettingsPage'
import { useAssistant } from './useAssistant'
import { useSettings } from './useSettings'

export function App() {
  const assistant = useAssistant()
  const { settings, save } = useSettings()
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard')

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <StatusOrb status={assistant.status} />
        <h1>Bing Bong</h1>
        <button
          type="button"
          className="chrome-button settings-toggle"
          aria-label={view === 'settings' ? 'Back to dashboard' : 'Open settings'}
          aria-pressed={view === 'settings'}
          onClick={() => setView(view === 'settings' ? 'dashboard' : 'settings')}
        >
          ⚙
        </button>
      </header>

      <main className="dashboard-main">
        {view === 'settings' ? (
          settings ? (
            <SettingsPage settings={settings} onSave={save} onClose={() => setView('dashboard')} />
          ) : (
            <p className="settings-loading">Loading settings…</p>
          )
        ) : (
          <BrowserPane />
        )}
      </main>

      <footer className="dashboard-footer">
        <AssistantPanel assistant={assistant} />
      </footer>
    </div>
  )
}
