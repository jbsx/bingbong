import { describe, expect, it } from 'vitest'
import type { PipelineEvent } from '../../core/pipeline/events'
import { createWindowEventPublisher, type WindowEventPublisherDeps } from './windowEventPublisher'

function harness() {
  const calls: string[] = []
  const deps: WindowEventPublisherDeps = {
    sendPipelineEvent: (event) => calls.push(`renderer:${event.type}`),
    sendVoiceState: () => calls.push('renderer:voice-state'),
    sendVoiceHeard: () => calls.push('renderer:voice-heard'),
    sendVoiceError: () => calls.push('renderer:voice-error'),
    sendBrowserState: () => calls.push('renderer:browser'),
    sendVoicePartial: () => calls.push('renderer:voice-partial'),
    overlayPipelineEvent: (event) => calls.push(`overlay:${event.type}`),
    overlayVoiceHeard: () => calls.push('overlay:voice-heard'),
    overlayVoiceError: () => calls.push('overlay:voice-error'),
  }
  return { calls, publisher: createWindowEventPublisher(deps) }
}

describe('window event publisher', () => {
  it('publishes run events to the renderer and the overlay, in that order', () => {
    const { calls, publisher } = harness()
    const event: PipelineEvent = { type: 'command', turnId: 't1', text: 'read', at: 1 }
    publisher.publish({ source: 'run', event })
    expect(calls).toEqual(['renderer:command', 'overlay:command'])
  })

  it('publishes download announcements through the same fan-out', () => {
    const { calls, publisher } = harness()
    publisher.publish({ source: 'download', event: { type: 'display', text: 'Saved file.pdf', at: 1 } })
    expect(calls).toEqual(['renderer:display', 'overlay:display'])
  })

  it('publishes the live partial to the renderer alone (#324)', () => {
    const { calls, publisher } = harness()
    publisher.publish({ source: 'voice-partial', partial: { text: 'open you', at: 4 } })
    expect(calls).toEqual(['renderer:voice-partial'])
  })

  it('publishes voice events through their source-specific sinks, overlay first', () => {
    const { calls, publisher } = harness()
    publisher.publish({ source: 'voice-state', state: { listening: true, reason: 'hotkey', monitoring: false, transcribing: false } })
    publisher.publish({ source: 'voice-heard', heard: { text: 'stop', routed: 'abort', at: 2 } })
    publisher.publish({ source: 'voice-error', error: { message: 'mic', at: 3 } })
    expect(calls).toEqual([
      'renderer:voice-state',
      'overlay:voice-heard',
      'renderer:voice-heard',
      'overlay:voice-error',
      'renderer:voice-error',
    ])
  })

  it('publishes browser state only to the renderer', () => {
    const { calls, publisher } = harness()
    publisher.publish({ source: 'browser', state: { url: 'https://x.test', title: 'x', loading: false, canGoBack: false, canGoForward: false } })
    expect(calls).toEqual(['renderer:browser'])
  })
})
