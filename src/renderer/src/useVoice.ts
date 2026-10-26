import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from '../../core/voice/ipcChannels'
import { reportRendererFault } from './diagnostics'
import { openMicCapture } from './micCapture'

export interface VoiceApi {
  /** True while the main-process session accepts mic audio (hotkey or confirmation window). */
  listening: boolean
  /** True while a finished utterance is being transcribed — the STT window (#38). */
  transcribing: boolean
  /** Speech has started in the Utterance being taken (#441); false before it and from its Endpoint. */
  hearing: boolean
  /** Reason for listening — drives the hint line next to the orb. */
  reason: VoiceListenReason | null
  /** Wake-word monitoring is live — the mic stays open between commands. */
  monitoring: boolean
  /** The live partial transcript while the user speaks (#324); '' between Utterances. */
  partial: string
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
 * downmixes to mono, and whole 512-sample frames over IPC.
 */
export function useVoice(deps: UseVoiceDeps): VoiceApi {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [hearing, setHearing] = useState(false)
  const [reason, setReason] = useState<VoiceListenReason | null>(null)
  const [monitoring, setMonitoring] = useState(false)
  const [partial, setPartial] = useState('')

  // Latest deps without resubscribing when callers rebuild the object.
  const depsRef = useRef(deps)
  depsRef.current = deps

  // Mic graph follows the session state: opens on listening, tears down when
  // listening ends (hotkey disarm, utterance handled, window closed).
  const captureRef = useRef<{ stop(): void } | null>(null)
  const startingRef = useRef(false)

  const stopCapture = useCallback(() => {
    captureRef.current?.stop()
    captureRef.current = null
  }, [])

  const startCapture = useCallback(async () => {
    if (captureRef.current || startingRef.current) return
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
      })
    } catch (err) {
      // The one renderer→history call the app had (#187): a mic failure
      // is a swallowed failure like any other, so it now takes the
      // diagnostics channel and the Feed line stamps its own clock —
      // the shared timestamp only ever existed to join the two.
      reportRendererFault('voice.startCapture', err)
      const message = err instanceof Error ? err.message : String(err)
      depsRef.current.onError(message, Date.now())
      await window.bingbong.voice.disarm()
    } finally {
      startingRef.current = false
    }
  }, [])

  useEffect(() => {
    const applyState = (state: VoiceState) => {
      setListening(state.listening)
      setTranscribing(state.transcribing)
      setHearing(state.hearing)
      setReason(state.reason)
      setMonitoring(state.monitoring)
      // The mic also stays up through the STT window: a discarded blip
      // returns to listening, and re-acquiring the device would eat the
      // first frames of whatever the user says next (#38).
      if (state.listening || state.transcribing || state.monitoring) {
        void startCapture()
      } else {
        stopCapture()
      }
    }
    const unsubscribeState = window.bingbong.voice.onState(applyState)
    // Monitoring can start before this component mounted — pull the truth.
    void window.bingbong.voice.getState().then(applyState)
    const unsubscribeHeard = window.bingbong.voice.onHeard((heard) => depsRef.current.onHeard(heard))
    const unsubscribeError = window.bingbong.voice.onError((error) =>
      depsRef.current.onError(error.message, error.at),
    )
    const unsubscribePartial = window.bingbong.voice.onPartial((event) => setPartial(event.text))
    return () => {
      unsubscribeState()
      unsubscribeHeard()
      unsubscribeError()
      unsubscribePartial()
    }
  }, [startCapture, stopCapture])

  useEffect(() => stopCapture, [stopCapture])

  return { listening, transcribing, hearing, reason, monitoring, partial }
}
