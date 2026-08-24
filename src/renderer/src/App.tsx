import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserNav, BrowserPane } from './BrowserPane'
import { AssistantPanel, RunHint, SessionExpiryControls, StatusOrb, StatusPill } from './AssistantPanel'
import { IdleScreen } from './IdleScreen'
import { SettingsPage } from './SettingsPage'
import { SubagentCards } from './SubagentCards'
import { useActiveSession } from './useActiveSession'
import { useAssistant } from './useAssistant'
import { useFeedPanel, useFeedSlotRect } from './useFeedPanel'
import { useIdle } from './useIdle'
import { useSettings } from './useSettings'
import { useSessionExpiry } from './useSessionExpiry'
import { useVoice } from './useVoice'
import { useWeather } from './useWeather'

export function App() {
  const assistant = useAssistant()
  const { settings, save } = useSettings()
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard')
  const idle = useIdle()
  const sessionExpiry = useSessionExpiry()
  // Feed panel layout state (#45): the panel renders in its own overlay
  // webContents above the browser pane; this slot is the rect its bounds
  // follow (overlay floats out-of-flow; docked takes real layout space).
  const panel = useFeedPanel()
  const feedSlotRef = useRef<HTMLDivElement>(null)
  useFeedSlotRect(feedSlotRef, `${panel.mode}-${panel.open}`)

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
  const { ping, idleNow } = idle
  useEffect(() => {
    const unsubEvent = window.bingbong.assistant.onEvent((event) => {
      if (event.type === 'session_ended') idleNow()
      else if (!event.type.startsWith('session_')) ping()
    })
    const unsubVoice = window.bingbong.voice.onState((state) => {
      if (state.listening) ping()
    })
    const unsubHeard = window.bingbong.voice.onHeard(() => ping())
    return () => {
      unsubEvent()
      unsubVoice()
      unsubHeard()
    }
  }, [idleNow, ping])

  // The hotkey arms the ears: Ctrl/Cmd+Space toggles listening. (The feed
  // panel's Ctrl/Cmd+Shift+F lives in main — before-input-event on every
  // input surface, so it works from the pane and overlay too, #45.)
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

  // Transcribing outranks listening (#38): the endpoint fired, STT is
  // thinking — never claim the ear is open while it works.
  const status = voice.transcribing ? 'transcribing' : voice.listening ? 'listening' : assistant.status
  // The Active Session gate (#70): while the newest run finished within the
  // Session Window (or a run is in progress), the idle timeout never swaps
  // the dashboard for the idle screen — a 5-minute pause mid-Session keeps
  // the work on screen. Only a lapsed (or never-started) session idles.
  const activeSession = useActiveSession()
  // Never idle over a running command, an open mic, the STT window, or the
  // settings page — the timer must not unmount a form mid-edit.
  const showIdle =
    idle.idle &&
    status === 'idle' &&
    !voice.listening &&
    !voice.transcribing &&
    view === 'dashboard' &&
    !activeSession
  const weather = useWeather(settings?.weather ?? null, showIdle)

  if (showIdle) {
    return <IdleScreen weather={weather} />
  }

  return (
    <div className={window.bingbong.app.kiosk ? 'dashboard dashboard--kiosk' : 'dashboard'}>
      {/* The Toolbar (ADR 0012): the one reserved band above the pane —
          never overlapping it — and the window's only drag region. Status
          Capsule left, address field center, controls right; the app title
          is gone. Interactive controls opt out of the drag region in CSS. */}
      <header className="toolbar">
        {/* The Status Capsule (ADR 0012): orb + pill + the live run/voice
            hints collapsed into one control. The class hooks inside
            (.status-orb--*, .status-pill, .voice-hint, .run-hint) are
            load-bearing e2e observation points. */}
        <div className="status-capsule">
          <StatusOrb status={status} />
          <StatusPill status={status} />
          {/* Run progress (#43) keeps its place even when the mic opens
              mid-run — the climbing timer must never disappear behind a
              listening hint, or a long round reads as frozen again. */}
          {assistant.progress ? <RunHint progress={assistant.progress} /> : null}
          {sessionExpiry.expiry ? (
            <SessionExpiryControls
              expiry={sessionExpiry.expiry}
              onExtend={sessionExpiry.extend}
              onDecline={sessionExpiry.decline}
            />
          ) : null}
          {voice.transcribing ? (
            <span className="voice-hint voice-hint--transcribing" role="status">
              transcribing…
            </span>
          ) : voice.listening ? (
            <span className="voice-hint" role="status">
              {voice.reason === 'confirmation'
                ? 'listening — yes or no?'
                : voice.reason === 'session-expiry'
                  ? 'listening — keep this session?'
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
        </div>
        {/* The address field lives in the Toolbar only while browsing
            (ADR 0012); settings keeps capsule + controls. */}
        {view === 'dashboard' ? <BrowserNav /> : null}
        <div className="toolbar-actions">
          <button
            type="button"
            className="chrome-button feed-panel-toggle"
            aria-label={panel.open ? 'Collapse the activity feed' : 'Open the activity feed'}
            aria-pressed={panel.open}
            title="Activity feed (Ctrl+Shift+F)"
            onClick={() => window.bingbong.feedPanel.toggle()}
          >
            ▤
          </button>
          <button
            type="button"
            className="chrome-button settings-toggle"
            aria-label={view === 'settings' ? 'Back to dashboard' : 'Open settings'}
            aria-pressed={view === 'settings'}
            onClick={() => setView(view === 'settings' ? 'dashboard' : 'settings')}
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        {/* The feed panel slot (#45) reports where the panel's native
            overlay view sits — floating above the browsing area in overlay
            mode, beside it in docked mode, a slim edge tab when collapsed.
            Identical in kiosk mode; the panel itself renders elsewhere.
            The width (#65) rides the folded panel state as a CSS var; the
            slot rules clamp it to [320px, 75% of the workspace]. */}
        <div
          className="dashboard-workspace"
          style={{ '--feed-panel-width': `${panel.width}px` } as React.CSSProperties}
        >
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
          {/* The slot always carries the mode — collapsed or not — so the
              persisted layout is observable (and assertable) at boot. */}
          <div
            ref={feedSlotRef}
            className={`feed-slot feed-slot--${panel.mode}${panel.open ? '' : ' feed-slot--collapsed'}`}
            aria-hidden="true"
          />
        </div>
      </main>

      {/* Transient cards only — typed input lives in the feed panel's
          prompt bar (ADR 0011), and the band renders only while a card is
          pending. The card floats centered on canvas (ADR 0012); it cannot
          overlay the native pane, so it keeps this in-flow band. */}
      {assistant.pendingConfirmation || assistant.pendingAsk ? (
        <footer className="dashboard-footer">
          <AssistantPanel assistant={assistant} />
        </footer>
      ) : null}
    </div>
  )
}
