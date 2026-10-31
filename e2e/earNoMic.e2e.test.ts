import { afterEach, describe, expect, it } from 'vitest'
import { EAR_FAILED, EAR_FAILED_MORE, REST_HINT } from '../src/core/voice/voiceHint'
import { feedText } from './feed'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// A mic that will not open (#530, ui.md 5): the Glance surface's first job is
// to show whether speaking now will be heard. No fake mic and a dead sound
// server: getUserMedia rejects for real, through the real capture road. The
// scripts keep the wake engine up, so the ear is monitoring with no capture.

const DEAD_MIC = {
  PULSE_SERVER: 'unix:/nonexistent',
  BINGBONG_WAKE_ENGINE: 'node',
  BINGBONG_WAKE_SCRIPT: '[0.01]',
  BINGBONG_VAD_SCRIPT: '[0.01]',
  BINGBONG_STT_SCRIPT: '[]',
}

/** Counts every ask of the microphone from here on, still rejected by the dead sound server. */
const COUNT_ASKS = `(() => {
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  window.__micAsks = 0
  window.__micFails = 0
  navigator.mediaDevices.getUserMedia = (constraints) => {
    window.__micAsks += 1
    return real(constraints).catch((error) => {
      window.__micFails += 1
      throw error
    })
  }
  return 'counting'
})()`

/** The microphone comes back: a silent stream of the kind a real one gives, from a context with no output device. */
const MIC_BACK = `(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext({ sinkId: { type: 'none' } })
    const destination = context.createMediaStreamDestination()
    const source = context.createConstantSource()
    source.connect(destination)
    source.start()
    window.__micStream = destination.stream
    return destination.stream
  }
  return 'back'
})()`

/** The device goes while its capture is open: the track ends with nobody having stopped it. */
const MIC_LOST = `window.__micStream.getTracks().forEach((track) => track.dispatchEvent(new Event('ended'))) ?? 'lost'`

const DEVICE_CHANGE = `navigator.mediaDevices.dispatchEvent(new Event('devicechange')) && 'fired'`

describe('an ear whose capture will not open (#530)', () => {
  let harness: Harness | undefined

  afterEach(async () => {
    await harness?.quit()
    harness = undefined
  })

  const pill = (): Promise<string> => harness!.dashboardEval<string>(`document.querySelector('.status-pill')?.textContent ?? ''`)
  const untilFailed = (): Promise<unknown> =>
    waitFor(async () => ((await harness!.dashboardEval<boolean>(`!!document.querySelector('.voice-hint--failed')`)) ? true : undefined), { timeoutMs: 20_000, intervalMs: 100 })

  it('says the ear did not start, and invites no speech', async () => {
    harness = await startHarness({ env: DEAD_MIC })
    await untilFailed()
    expect(await pill()).toBe(EAR_FAILED)
    expect(await harness.dashboardEval<string>(`document.querySelector('.voice-hint--failed')?.textContent ?? ''`)).toBe(EAR_FAILED_MORE)
    expect(await harness.dashboardEval<boolean>(`!!document.querySelector('.voice-hint--monitoring')`)).toBe(false)
    expect(await harness.dashboardEval<string>('document.body.innerText')).not.toContain(REST_HINT)
  }, 60_000)

  it('asks once per device change while the mic stays dead, without a Feed line each time, and comes back to Ready when one opens', async () => {
    harness = await startHarness({ env: DEAD_MIC })
    await untilFailed()
    await harness.dashboardEval(COUNT_ASKS)
    const lines = await waitFor(
      async () => {
        const text = await feedText(harness!)
        return text === '' ? undefined : text
      },
      { timeoutMs: 10_000, intervalMs: 50 },
    )

    // The failure's own state publish, and any state after it, do not ask again: nothing here is hammering a dead device.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(await harness.dashboardEval<number>('window.__micAsks')).toBe(0)

    await harness.dashboardEval(DEVICE_CHANGE)
    await waitFor(async () => ((await harness!.dashboardEval<number>('window.__micFails')) === 1 ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
    expect(await harness.dashboardEval<number>('window.__micAsks')).toBe(1)
    expect(await pill()).toBe(EAR_FAILED)
    expect(await feedText(harness)).toBe(lines)

    await harness.dashboardEval(MIC_BACK)
    await harness.dashboardEval(DEVICE_CHANGE)
    await waitFor(async () => ((await pill()) === 'Ready' ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
    expect(await harness.dashboardEval<string>(`document.querySelector('.voice-hint--monitoring')?.textContent ?? ''`)).toBe(REST_HINT)
    expect((await harness.dashboardEval<{ captureFailed?: boolean }>('window.bingbong.voice.getState()')).captureFailed).toBeUndefined()
  }, 60_000)

  it('a Ctrl+Space with the mic back opens a listen, and it stays open', async () => {
    harness = await startHarness({ env: DEAD_MIC })
    await untilFailed()
    await harness.dashboardEval(MIC_BACK)
    await harness.dashboardEval('window.bingbong.voice.arm()')
    await waitFor(async () => ((await harness!.dashboardEval<{ listening: boolean; captureFailed?: boolean }>('window.bingbong.voice.getState()')).captureFailed === undefined ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
    expect((await harness.dashboardEval<{ listening: boolean }>('window.bingbong.voice.getState()')).listening).toBe(true)
  }, 60_000)

  it('hears through the capture that came back: its frames reach the wake word', async () => {
    harness = await startHarness({ env: { ...DEAD_MIC, BINGBONG_VAD_SCRIPT: '[0.95]', BINGBONG_WAKE_SCRIPT: JSON.stringify([0.01, 0.99, 0.01]) } })
    await untilFailed()
    await harness.dashboardEval(MIC_BACK)
    await harness.dashboardEval(DEVICE_CHANGE)
    const state = await waitFor(
      async () => {
        const now = await harness!.dashboardEval<{ reason: string | null }>('window.bingbong.voice.getState()')
        return now.reason === 'wake' ? now : undefined
      },
      { timeoutMs: 20_000, intervalMs: 50 },
    )
    expect(state.reason).toBe('wake')
  }, 60_000)

  it('says so when the open capture loses its device, says one Feed line, and comes back on a device change', async () => {
    harness = await startHarness({ env: DEAD_MIC })
    await untilFailed()
    await harness.dashboardEval(MIC_BACK)
    await harness.dashboardEval(DEVICE_CHANGE)
    await waitFor(async () => ((await pill()) === 'Ready' ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })

    await harness.dashboardEval(MIC_LOST)
    await untilFailed()
    expect(await pill()).toBe(EAR_FAILED)
    await waitFor(async () => ((await feedText(harness!)).includes('The microphone went away') ? true : undefined), { timeoutMs: 5_000, intervalMs: 50 })

    await harness.dashboardEval(DEVICE_CHANGE)
    await waitFor(async () => ((await pill()) === 'Ready' ? true : undefined), { timeoutMs: 10_000, intervalMs: 50 })
  }, 60_000)
})
