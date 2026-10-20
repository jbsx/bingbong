import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserNav, BrowserPane } from './BrowserPane'
import { ChromeIcon } from './ChromeIcon'
import { capsuleTone, RunHint, StatusOrb, StatusPill, VoiceWave } from './AssistantPanel'
import { IdleScreen } from './IdleScreen'
import { IdlePrompt } from './IdlePrompt'
import { usePaneHasPage } from './usePaneHasPage'
import { SettingsPage } from './SettingsPage'
import { WeightPage } from './WeightPage'
import { WeighInPopup } from './WeighInPopup'
import { useWeighInPopup, useWeighIns } from './useWeight'
import { useAssistant } from './useAssistant'
import { overlaySlotContent } from '../../core/panel/peekCardState'
import { weighInPopupSurface } from '../../core/scale/weighInPopup'
import { useFeedPanel, useFeedSlotRect, useWeighInSlotRect } from './useFeedPanel'
import { useIdle } from './useIdle'
import { useLastPage } from './useLastPage'
import { useTimer } from './useTimer'
import { ToolbarWidgets } from './ToolbarWidgets'
import { useNowPlaying } from './useNowPlaying'
import { useUsage } from './useUsage'
import { useNews } from './useNews'
import { defaultUsagePrefs } from '../../core/usage/usage'
import { JAISH } from '../../core/scale/people'
import { defaultWeightSettings } from '../../core/scale/weightSettings'
import { usePeekCard } from './usePeekCard'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'
import { useWeather } from './useWeather'
import { voiceHint } from '../../core/voice/voiceHint'
import { wakesIdleScreen } from '../../core/idle/idleWake'

export function App() {
  const assistant = useAssistant()
  const { settings, save } = useSettings()
  // Settings and the Weight page (#350) are full-window views beside the browsing dashboard, each with its own Back.
  const [view, setView] = useState<'dashboard' | 'settings' | 'weight'>('dashboard')
  // The Person the Weight page opens on (#351): Jaish, unless a row of the Weight card named another.
  const [weightPerson, setWeightPerson] = useState(JAISH)
  // The Idle Prompt (#361): its draft while open, null while closed; and whether its field holds focus.
  const [promptDraft, setPromptDraft] = useState<string | null>(null)
  const [promptFocused, setPromptFocused] = useState(false)
  // The blank pane is never shown (#361): with no page, a tap leaves the Idle Screen up, as one with the Prompt open does.
  const paneHasPage = usePaneHasPage()
  const idle = useIdle({ tapWakes: () => paneHasPage && promptDraft === null })
  // Feed panel layout state (#45): the panel renders in its own overlay
  // webContents above the browser pane; this slot is the rect its bounds
  // follow (overlay floats out-of-flow; docked takes real layout space).
  const panel = useFeedPanel()
  // The Peek Card (ADR 0021, 0026, 0029): voice's report surface while
  // the panel is Collapsed — shown by activity, retired by opening the
  // panel, revived by closing it mid-run. It renders in the panel's
  // overlay view (ADR 0029); the dashboard folds the same events only
  // to size the slot rect the card floats in.
  const peek = usePeekCard(panel.open)
  // The Weigh-in pop-up (#350): over the browsing pane it has a view of its
  // own in the Peek Card's place (or rides the open panel's top), so the
  // edge tab stays; over every other view the dashboard draws it.
  const weighInPopup = useWeighInPopup()
  const weighIns = useWeighIns()
  const slotContent = overlaySlotContent(panel.open, peek.state)
  // Nothing of the panel's ever covers the settings page or the Weight
  // page (#329, #334): while one is open the slot reports no bounds and
  // takes no room, and leaving it brings back whatever showed before —
  // open or collapsed, Overlay or Docked, same width. Hiding never touches
  // the panel's state, so it is not the system opening or closing it.
  const fullViewShown = view !== 'dashboard'
  const feedSlotRef = useFeedSlotRect(`${panel.mode}-${slotContent}`, fullViewShown)
  const weighInSurface = weighInPopupSurface(weighInPopup, !fullViewShown, panel.open)
  const weighInSlotRef = useWeighInSlotRect(weighInSurface !== 'view')

  const getMicId = useCallback(() => settings?.micId ?? 'default', [settings])
  const voice = useVoice({
    getMicId,
    onHeard: assistant.appendVoiceHeard,
    onError: assistant.appendVoiceError,
  })

  // Whether the Idle Screen is up, as of the last render: once up it is
  // sticky, and only input or a Command that acts on the pane wakes it.
  const idleUp = useRef(false)

  // Real activity — a command running, speech heard, a listen starting —
  // counts as "not idle" alongside input, so the idle screen never covers a
  // working assistant. Over the Idle Screen itself only a Command that acts
  // on the pane is that: the Timer and a Stop are heard and performed with
  // the rest state left up. (Wake-monitoring on/off transitions are not
  // activity; pinging on those would cancel the boot-into-idle state.)
  const { ping } = idle
  useEffect(() => {
    const unsubEvent = window.bingbong.assistant.onEvent((event) => {
      if (!idleUp.current || wakesIdleScreen(event)) ping()
    })
    const unsubVoice = window.bingbong.voice.onState((state) => {
      if (state.listening && !idleUp.current) ping()
    })
    const unsubHeard = window.bingbong.voice.onHeard(() => {
      if (!idleUp.current) ping()
    })
    return () => {
      unsubEvent()
      unsubVoice()
      unsubHeard()
    }
  }, [ping])

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
  // Never go idle over a running command, an open mic, the STT window, or
  // the settings page — the timer must not unmount a form mid-edit. Once
  // up, the Idle Screen stays up through them until something wakes it.
  const quiet = status === 'idle' && !voice.listening && !voice.transcribing
  const showIdle = idle.idle && view === 'dashboard' && (quiet || idleUp.current)
  idleUp.current = showIdle
  // The Voice Prompt (#359) rides the open panel's footer over the browsing pane: while it is on screen it carries
  // the hint and the live words, and the capsule says only the state; collapsed, the capsule keeps them.
  const hint = voiceHint(voice, { promptShown: panel.open && view === 'dashboard' })
  const weather = useWeather(settings?.weather ?? null, showIdle)
  const lastPage = useLastPage(showIdle)
  // Followed always: the Idle Screen shows them (the Timer Clock, the Now Playing line), and so do the Toolbar's widgets while the app is in use.
  const timer = useTimer()
  const nowPlaying = useNowPlaying()
  const usage = useUsage(settings?.usageDashboard.url ?? null, showIdle)
  const news = useNews(showIdle)

  // Main sends a key typed on the Idle Screen to the Idle Prompt, so it has to know the screen is up and the Prompt's field focused.
  const prompting = showIdle && promptDraft !== null && promptFocused
  useEffect(() => window.bingbong.idle.reportShown({ up: showIdle, prompting }), [showIdle, prompting])
  useEffect(() => window.bingbong.idle.onTyped((text) => setPromptDraft((draft) => (draft ?? '') + text)), [])
  // The Prompt goes with the screen.
  useEffect(() => {
    if (!showIdle) setPromptDraft(null)
  }, [showIdle])

  if (showIdle) {
    return (
      <>
        <IdleScreen
          weather={weather}
          usage={usage}
          usagePrefs={settings?.usageDashboard ?? defaultUsagePrefs()}
          cards={settings?.idleCards}
          news={news}
          lastPage={lastPage}
          timer={timer}
          nowPlaying={nowPlaying}
          weighIns={weighIns}
          weight={settings?.weight}
          onOpenWeight={(person) => {
            setWeightPerson(person)
            setView('weight')
          }}
          status={status}
          voice={voice}
          popup={weighInPopup.phase === 'hidden' ? null : <WeighInPopup state={weighInPopup} />}
        />
        {promptDraft !== null ? <IdlePrompt draft={promptDraft} onDraft={setPromptDraft} onClose={() => setPromptDraft(null)} onFocused={setPromptFocused} /> : null}
      </>
    )
  }

  return (
    <div className={window.bingbong.app.kiosk ? 'dashboard dashboard--kiosk' : 'dashboard'}>
      {/* The Toolbar (ADR 0012): the one reserved band above the pane —
          never overlapping it — and the window's only drag region. Status
          Capsule left, address field center, controls right. Interactive
          controls opt out of the drag region in CSS. */}
      <header className="toolbar">
        {/* The Status Capsule (ADR 0012): orb + pill + the live run/voice
            hints collapsed into one control. The class hooks inside
            (.status-orb--*, .status-pill, .voice-hint, .run-hint) are
            load-bearing e2e observation points. */}
        <div className="toolbar-start">
          <div className={`status-capsule status-capsule--${capsuleTone(status)}`}>
            <StatusOrb status={status} />
            <StatusPill status={status} />
            {status === 'listening' ? <VoiceWave bars={6} /> : null}
            {/* Run progress (#43) keeps its place even when the mic opens
                mid-run — the climbing timer must never disappear behind a
                listening hint, or a long round reads as frozen again. */}
            {assistant.progress ? <RunHint progress={assistant.progress} status={status} /> : null}
            {/* The voice hint carries instruction or the live partial
                transcript (#324) — never the pill's state word again (#331). */}
            {hint ? (
              <span className={`voice-hint voice-hint--${hint.kind}`} role="status">
                {hint.text}
              </span>
            ) : null}
          </div>
          {/* The running Timer and the song Now Playing (owner ruling 2026-10-19), in sight while the app is in use. */}
          <ToolbarWidgets timer={timer} nowPlaying={nowPlaying} />
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
            <ChromeIcon name="panel" />
          </button>
          <button
            type="button"
            className="chrome-button settings-toggle"
            aria-label={view === 'settings' ? 'Back to dashboard' : 'Open settings'}
            aria-pressed={view === 'settings'}
            onClick={() => setView(view === 'settings' ? 'dashboard' : 'settings')}
          >
            <ChromeIcon name="settings" />
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
          ) : view === 'weight' ? (
            <WeightPage weighIns={weighIns} people={settings?.weight.people ?? defaultWeightSettings().people} initialPerson={weightPerson} onClose={() => setView('dashboard')} />
          ) : (
            <div className="dashboard-browsing">
              <BrowserPane />
            </div>
          )}
          {/* The slot always carries the mode — collapsed or not — so the
              persisted layout is observable (and assertable) at boot. */}
          <div
            ref={feedSlotRef}
            className={`feed-slot feed-slot--${panel.mode}${
              slotContent === 'card' ? ' feed-slot--peek' : slotContent === 'tab' ? ' feed-slot--collapsed' : ''
            }${fullViewShown ? ' feed-slot--hidden' : ''}`}
            aria-hidden="true"
          />
          {/* The Weigh-in pop-up's own view over the pane follows this rect. */}
          <div ref={weighInSlotRef} className="weighin-slot" aria-hidden="true" />
        </div>
      </main>
      {/* Over Settings and the Weight page no native view covers the dashboard, so the pop-up is drawn here. */}
      {weighInSurface === 'dashboard' ? <WeighInPopup state={weighInPopup} /> : null}
    </div>
  )
}
