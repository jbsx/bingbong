import { useCallback, useEffect, useState } from 'react'
import { BrowserPane } from './BrowserPane'
import { AssistantPanel, StatusOrb } from './AssistantPanel'
import { SettingsPage } from './SettingsPage'
import { useAssistant } from './useAssistant'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'

export function App() {
  const assistant = useAssistant()
  const { settings, save } = useSettings()
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard')

  const getMicId = useCallback(() => settings?.micId ?? 'default', [settings])
  const voice = useVoice({
    getMicId,
    onHeard: assistant.appendVoiceHeard,
    onError: assistant.appendVoiceError,
  })

  // The hotkey arms the ears: Ctrl/Cmd+Space toggles listening.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault()
        voice.toggleHotkey()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [voice])

  const orbStatus = voice.listening ? 'listening' : assistant.status

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <StatusOrb status={orbStatus} />
        <h1>Bing Bong</h1>
        {voice.listening ? (
          <span className="voice-hint" role="status">
            {voice.reason === 'confirmation' ? 'listening — yes or no?' : 'listening — say a command'}
          </span>
        ) : voice.monitoring ? (
          <span className="voice-hint voice-hint--monitoring" role="status">
            say “hey jarvis” or press Ctrl+Space
          </span>
        ) : null}
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
