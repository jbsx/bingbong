import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceHeardEvent, VoiceListenReason, VoiceState } from '../../core/voice/ipcChannels'
import { VAD_FRAME_SAMPLES } from '../../core/voice/vadEndpointing'

const TARGET_RATE = 16000
const FRAME = VAD_FRAME_SAMPLES
const FRAMES_PER_CHUNK = 4

export interface VoiceApi {
  /** True while the main-process session accepts mic audio (hotkey or confirmation window). */
  listening: boolean
  /** Reason for listening — drives the hint line next to the orb. */
  reason: VoiceListenReason | null
  /** Wake-word monitoring is live — the mic stays open between commands. */
  monitoring: boolean
  /** Hotkey handler — arm when idle, disarm when listening. */
  toggleHotkey(): void
}

export interface UseVoiceDeps {
  /** Mic device from the settings page ('default' prefers the C920, then the OS default). */
  getMicId(): string
  onHeard(heard: VoiceHeardEvent): void
  onError(message: string): void
}

/** The C920 is the default per spec; labels are empty until permission exists. */
async function preferC920(micId: string): Promise<string> {
  if (micId !== 'default' && micId !== '') return micId
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const c920 = devices.find((device) => device.kind === 'audioinput' && /c920/i.test(device.label))
    return c920?.deviceId ?? micId
  } catch {
    return micId
  }
}

/**
 * Renderer half of the ears (T9/T10): the hotkey (Ctrl/Cmd+Space) arms the
 * main-process session, and the mic opens whenever the session says it is
 * listening — for the hotkey, the wake word, or the confirmation window's
 * 12 s voice answers. With wake monitoring enabled the mic simply stays
 * open: the session endpoints an utterance after each activation, then falls
 * back to listening for the wake word. The AudioContext resamples to 16 kHz;
 * the worklet downmixes to mono and whole 512-sample frames go over IPC.
 */
export function useVoice(deps: UseVoiceDeps): VoiceApi {
  const [listening, setListening] = useState(false)
  const [reason, setReason] = useState<VoiceListenReason | null>(null)
  const [monitoring, setMonitoring] = useState(false)

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(micId === 'default' || micId === '' ? {} : { deviceId: { exact: micId } }),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const context = new AudioContext({ sampleRate: TARGET_RATE })
      try {
        await context.audioWorklet.addModule(new URL('./micCaptureWorklet.js', import.meta.url))
      } catch {
        stream.getTracks().forEach((track) => track.stop())
        await context.close()
        throw new Error('mic capture worklet failed to load')
      }
      const source = context.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(context, 'bingbong-capture')
      source.connect(node)

      // Buffer whole frames so IPC chunks are always a multiple of 512 samples.
      let carry = new Float32Array(0)
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const merged = new Float32Array(carry.length + event.data.length)
        merged.set(carry)
        merged.set(event.data, carry.length)
        const frames = Math.floor(merged.length / FRAME)
        if (frames >= FRAMES_PER_CHUNK) {
          const send = frames * FRAME
          window.bingbong.voice.sendAudio(merged.subarray(0, send))
          carry = merged.slice(send)
        } else {
          carry = merged
        }
      }

      captureRef.current = {
        stop: () => {
          node.port.onmessage = null
          source.disconnect()
          node.disconnect()
          stream.getTracks().forEach((track) => track.stop())
          void context.close()
        },
      }
    } catch (err) {
      depsRef.current.onError(err instanceof Error ? err.message : String(err))
      await window.bingbong.voice.disarm()
    } finally {
      startingRef.current = false
    }
  }, [])

  const toggleHotkey = useCallback(() => {
    if (listening) {
      void window.bingbong.voice.disarm()
      return
    }
    void window.bingbong.voice.arm()
  }, [listening])

  useEffect(() => {
    const applyState = (state: VoiceState) => {
      setListening(state.listening)
      setReason(state.reason)
      setMonitoring(state.monitoring)
      if (state.listening || state.monitoring) {
        void startCapture()
      } else {
        stopCapture()
      }
    }
    const unsubscribeState = window.bingbong.voice.onState(applyState)
    // Monitoring can start before this component mounted — pull the truth.
    void window.bingbong.voice.getState().then(applyState)
    const unsubscribeHeard = window.bingbong.voice.onHeard((heard) => depsRef.current.onHeard(heard))
    const unsubscribeError = window.bingbong.voice.onError((error) => depsRef.current.onError(error.message))
    return () => {
      unsubscribeState()
      unsubscribeHeard()
      unsubscribeError()
    }
  }, [startCapture, stopCapture])

  useEffect(() => stopCapture, [stopCapture])

  return { listening, reason, monitoring, toggleHotkey }
}
