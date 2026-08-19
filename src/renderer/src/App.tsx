import { useCallback, useEffect, useState } from 'react'
import { ActivityFeed } from './ActivityFeed'
import { BrowserPane } from './BrowserPane'
import { AssistantPanel, RunHint, StatusOrb } from './AssistantPanel'
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
  }, [assistant, voice])

  // Transcribing outranks listening (#38): the endpoint fired, STT is
  // thinking — never claim the ear is open while it works.
  const orbStatus = voice.transcribing ? 'transcribing' : voice.listening ? 'listening' : assistant.status
  // Never idle over a running command, an open mic, the STT window, or the
  // settings page — the timer must not unmount a form mid-edit.
  const showIdle = idle.idle && orbStatus === 'idle' && !voice.listening && !voice.transcribing && view === 'dashboard'
  const weather = useWeather(settings?.weather ?? null, showIdle)

  if (showIdle) {
    return <IdleScreen entries={assistant.feed} weather={weather} />
  }

  return (
    <div className={window.bingbong.app.kiosk ? 'dashboard dashboard--kiosk' : 'dashboard'}>
      <header className="dashboard-header">
        <StatusOrb status={orbStatus} />
        <h1>Bing Bong</h1>
        {/* Run progress (#43) keeps its place even when the mic opens
            mid-run — the climbing timer must never disappear behind a
            listening hint, or a long round reads as frozen again. */}
        {assistant.progress ? <RunHint progress={assistant.progress} /> : null}
        {voice.transcribing ? (
          <span className="voice-hint voice-hint--transcribing" role="status">
            transcribing…
          </span>
        ) : voice.listening ? (
          <span className="voice-hint" role="status">
            {voice.reason === 'confirmation'
              ? 'listening — yes or no?'
              : voice.reason === 'ask'
                ? 'listening — your answer'
                : voice.reason === 'pause'
                  ? 'paused — say resume or steer me'
                  : 'listening — say a command'}
          </span>
        ) : voice.monitoring ? (
          <span className="voice-hint voice-hint--monitoring" role="status">
            say “bing bong” or press Ctrl+Space
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
        {/* The feed panel (#44) owns observation on the right edge — the
            same panel in dashboard and kiosk mode; interactions stay in the
            footer. */}
        <div className="dashboard-workspace">
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
          <aside className="feed-panel">
            <ActivityFeed entries={assistant.feed} />
          </aside>
        </div>
      </main>

      <footer className="dashboard-footer">
        <AssistantPanel assistant={assistant} />
      </footer>
    </div>
  )
}
