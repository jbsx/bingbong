import { useCallback, useEffect, useRef, useState } from 'react'
import { CAPTURE_RETRY_MS, EAR_SHUT, earAsksCapture, opensCapture, type EarAsk } from '../../core/voice/captureAsk'
import type { EarLoading, VoiceHeardEvent, VoiceListenReason, VoiceState } from '../../core/voice/ipcChannels'
import { reportRendererFault } from './diagnostics'
import { openMicCapture } from './micCapture'

export interface VoiceApi {
  /** True while the main-process session accepts mic audio (hotkey or confirmation window). */
  listening: boolean
  /** True while a finished utterance is being transcribed — the STT window (#38). */
  transcribing: boolean
  /** Speech has started in the Utterance being taken (#441); false before it and from its Endpoint. */
  hearing: boolean
  /** The app's own voice is playing (#472): an open ear that has heard nothing is shown at rest. */
  speaking: boolean
  /** The ear hears the person over the app's voice (#490): an open ear still listens while it plays. */
  overSpeech: boolean
  /** Reason for listening — drives the hint line next to the orb. */
  reason: VoiceListenReason | null
  /** Wake-word monitoring is live — the mic stays open between commands. */
  monitoring: boolean
  /** The live partial transcript while the user speaks (#324); '' between Utterances. */
  partial: string
  /** The Utterance's last words, kept through its read after the live partial clears (#442); '' with none. */
  lastWords: string
  /** What a cold ear still waits for (#442); absent once nothing is loading. */
  loading?: EarLoading
  /** When the ear's phase began, on main's wall clock (#442). */
  since?: number
  /** The Mic Mute is on: the ear is shown shut and the microphone is closed. */
  micMuted: boolean
  /** The microphone's capture did not open (#530): nothing said is heard until one does. Absent otherwise. */
  captureFailed?: boolean
}

export interface UseVoiceDeps {
  /** Mic device from the settings page ('default' prefers the C920, then the OS default). */
  getMicId(): string
  onHeard(heard: VoiceHeardEvent): void
  onError(message: string, at?: number): void
}

/** The C920 is the default per spec; labels are empty until permission exists. */
async function preferC920(micId: string): Promise<string> {
  if (micId !== 'default' && micId !== '') return micId
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const c920 = devices.find((device) => device.kind === 'audioinput' && /c920/i.test(device.label))
    return c920?.deviceId ?? micId
  } catch (error) {
    reportRendererFault('voice.enumerateDevices', error)
    return micId
  }
}

/**
 * Renderer half of the ears (T9/T10): the hotkey (Ctrl/Cmd+Space) arms the
 * main-process session, and the mic opens whenever the session says it is
 * listening — for the hotkey or the wake word. With wake monitoring enabled the mic simply stays
 * open: the session endpoints an utterance after each activation, then falls
 * back to listening for the wake word. The capture graph is `openMicCapture`
 * (micCapture.ts): a 16 kHz context with no output device, a worklet that
 * downmixes to mono, and whole 512-sample frames over IPC. A capture that does
 * not open, or loses its device, is told to main (#530) and tried again on a
 * device change, a new ask or a slow clock (captureAsk.ts), until one opens.
 */
export function useVoice(deps: UseVoiceDeps): VoiceApi {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [hearing, setHearing] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [overSpeech, setOverSpeech] = useState(false)
  const [reason, setReason] = useState<VoiceListenReason | null>(null)
  const [monitoring, setMonitoring] = useState(false)
  const [partial, setPartial] = useState('')
  // The Utterance's last words, kept past the Endpoint's clear for its read to name (#442); the next one's speech clears them.
  const [lastWords, setLastWords] = useState('')
  const hearingRef = useRef(false)
  const [loading, setLoading] = useState<EarLoading | undefined>(undefined)
  const [since, setSince] = useState<number | undefined>(undefined)
  const [micMuted, setMicMuted] = useState(false)
  const [captureFailed, setCaptureFailed] = useState(false)

  // Latest deps without resubscribing when callers rebuild the object.
  const depsRef = useRef(deps)
  depsRef.current = deps

  // Mic graph follows the session state: opens on listening, tears down when
  // listening ends (hotkey disarm, utterance handled, window closed).
  const captureRef = useRef<{ stop(): void } | null>(null)
  const startingRef = useRef(false)
  const failedRef = useRef(false)
  // A device change that came while a capture was opening: that try may have read the devices before it.
  const changedWhileStartingRef = useRef(false)
  // Someone asked during this try, so its failure is reported; a try nobody asked for fails quietly.
  const reportFailureRef = useRef(false)
  const askRef = useRef<EarAsk>(EAR_SHUT)

  const stopCapture = useCallback(() => {
    captureRef.current?.stop()
    captureRef.current = null
  }, [])

  // The capture is gone or never came: told to main, and any listen that needs it closes.
  const captureDown = useCallback(async (message?: string) => {
    failedRef.current = true
    window.bingbong.voice.captureFailed(true, message)
    await window.bingbong.voice.disarm()
  }, [])

  // `quiet`: nobody asked (a device change, the slow clock), so a try that fails again reports nothing.
  const startCapture = useCallback(async (quiet = false) => {
    if (captureRef.current) return
    if (!quiet) reportFailureRef.current = true
    if (startingRef.current) {
      if (quiet) changedWhileStartingRef.current = true
      return
    }
    startingRef.current = true
    try {
      const micId = await preferC920(depsRef.current.getMicId())
      captureRef.current = await openMicCapture(micId, {
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        createContext: (options) => new AudioContext(options),
        createWorkletNode: (context, name) => new AudioWorkletNode(context, name),
        workletUrl: new URL('./micCaptureWorklet.js', import.meta.url),
        send: (samples) => window.bingbong.voice.sendAudio(samples),
        onFault: reportRendererFault,
        onLost: () => {
          stopCapture()
          const message = 'The microphone went away'
          reportRendererFault('voice.captureLost', new Error(message))
          void captureDown(message)
        },
      })
      failedRef.current = false
      // Always told: main may hold a failure from before this renderer reloaded.
      window.bingbong.voice.captureFailed(false)
      // The ear shut while it opened: a retry can outlast a Mic Mute, and a muted microphone stays closed.
      if (!earAsksCapture(askRef.current)) stopCapture()
    } catch (err) {
      // A mic failure takes the diagnostics channel, and main stamps its Feed line (#187, #530).
      let message: string | undefined
      if (reportFailureRef.current) {
        reportRendererFault('voice.startCapture', err)
        message = err instanceof Error ? err.message : String(err)
      }
      await captureDown(message)
    } finally {
      startingRef.current = false
      reportFailureRef.current = false
      if (changedWhileStartingRef.current) {
        changedWhileStartingRef.current = false
        if (failedRef.current && earAsksCapture(askRef.current)) void startCapture(true)
      }
    }
  }, [stopCapture, captureDown])

  useEffect(() => {
    const applyState = (state: VoiceState) => {
      setListening(state.listening)
      setTranscribing(state.transcribing)
      setHearing(state.hearing)
      setSpeaking(state.speaking === true)
      setOverSpeech(state.overSpeech === true)
      if (state.hearing && !hearingRef.current) setLastWords('')
      hearingRef.current = state.hearing
      setReason(state.reason)
      setMonitoring(state.monitoring)
      setLoading(state.loading)
      setSince(state.since)
      setMicMuted(state.micMuted === true)
      setCaptureFailed(state.captureFailed === true)
      // The mic also stays up through the STT window: a discarded blip
      // returns to listening, and re-acquiring the device would eat the
      // first frames of whatever the user says next (#38).
      const before = askRef.current
      askRef.current = state
      if (opensCapture(before, state, failedRef.current)) void startCapture()
      else if (!earAsksCapture(state)) stopCapture()
    }
    const unsubscribeState = window.bingbong.voice.onState(applyState)
    // Monitoring can start before this component mounted — pull the truth.
    void window.bingbong.voice.getState().then(applyState)
    const unsubscribeHeard = window.bingbong.voice.onHeard((heard) => depsRef.current.onHeard(heard))
    const unsubscribeError = window.bingbong.voice.onError((error) =>
      depsRef.current.onError(error.message, error.at),
    )
    const unsubscribePartial = window.bingbong.voice.onPartial((event) => {
      setPartial(event.text)
      if (event.text !== '') setLastWords(event.text)
    })
    return () => {
      unsubscribeState()
      unsubscribeHeard()
      unsubscribeError()
      unsubscribePartial()
    }
  }, [startCapture, stopCapture])

  useEffect(() => stopCapture, [stopCapture])

  // The way back without a restart (#530): a device came or went, so the one that would not open may now.
  useEffect(() => {
    const onDeviceChange = (): void => {
      if (earAsksCapture(askRef.current)) void startCapture(true)
    }
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
    // A cause that clears with no device event (a sound server back, a mic someone freed, another mic chosen in Settings).
    const clock = setInterval(() => {
      if (failedRef.current && earAsksCapture(askRef.current)) void startCapture(true)
    }, CAPTURE_RETRY_MS)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
      clearInterval(clock)
    }
  }, [startCapture])

  return { listening, transcribing, hearing, speaking, overSpeech, reason, monitoring, partial, lastWords, micMuted, ...(captureFailed ? { captureFailed } : {}), ...(loading !== undefined ? { loading } : {}), ...(since !== undefined ? { since } : {}) }
}
