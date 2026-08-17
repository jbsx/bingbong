import { useCallback, useEffect, useState } from 'react'
import { BrowserPane } from './BrowserPane'
import { AssistantPanel, StatusOrb } from './AssistantPanel'
import { IdleScreen } from './IdleScreen'
import { SettingsPage } from './SettingsPage'
import { SubagentCards } from './SubagentCards'
import { useAssistant } from './useAssistant'
import { useIdle } from './useIdle'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'
import { useWeather } from './useWeather'

export function App() {
  const assistant = useAssistant()
  const { settings, save } = useSettings()
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard')
  const idle = useIdle()

  const getMicId = useCallback(() => settings?.micId ?? 'default', [settings])
  const voice = useVoice({
    getMicId,
    onHeard: assistant.appendVoiceHeard,
    onError: assistant.appendVoiceError,
  })

  // Real activity — a command running, speech heard, a listen starting —
  // counts as "not idle" alongside input, so the idle screen never covers a
  // working assistant. (Wake-monitoring on/off transitions are not activity;
  // pinging on those would cancel the boot-into-idle state.)
  const { ping } = idle
  useEffect(() => {
    const unsubEvent = window.bingbong.assistant.onEvent(() => ping())
    const unsubVoice = window.bingbong.voice.onState((state) => {
      if (state.listening) ping()
    })
    const unsubHeard = window.bingbong.voice.onHeard(() => ping())
    return () => {
      unsubEvent()
      unsubVoice()
      unsubHeard()
    }
  }, [ping])

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
  // Never idle over a running command, an open mic, or the settings page —
  // the timer must not unmount a form mid-edit.
  const showIdle = idle.idle && orbStatus === 'idle' && !voice.listening && view === 'dashboard'
  const weather = useWeather(settings?.weather ?? null, showIdle)

  if (showIdle) {
    return <IdleScreen entries={assistant.entries} weather={weather} />
  }

  return (
    <div className={window.bingbong.app.kiosk ? 'dashboard dashboard--kiosk' : 'dashboard'}>
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
          <div className="dashboard-browsing">
            <SubagentCards agents={assistant.agents} />
            <BrowserPane />
          </div>
        )}
      </main>

      <footer className="dashboard-footer">
        <AssistantPanel assistant={assistant} />
      </footer>
    </div>
  )
}
