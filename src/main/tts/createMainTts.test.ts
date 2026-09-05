import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import type { HostTraceEvent } from '../../core/trace/hostTrace'
import { createMainTts } from './createMainTts'

// The composition root is where a dependency goes missing without anything
// failing: an optional dep that main resolves and this factory forgets to
// forward is dropped in silence, and the records simply never appear. So
// the wiring itself is pinned here (#186) — the `tts_line` record is
// written before synthesis, so a line that piper can never render still
// proves the writer arrived.

const DEAD_PANE = { isDestroyed: () => true } as unknown as WebContents

describe('createMainTts', () => {
  it('forwards the Host Trace writer to the speech coordinator', async () => {
    const traced: HostTraceEvent[] = []
    const tts = createMainTts({
      config: { bin: '/nonexistent/piper', voicesDir: '/nonexistent/voices', voiceId: 'test' },
      pane: DEAD_PANE,
      getVoiceId: () => 'test',
      hostTrace: (event) => traced.push(event()),
    })

    // piper cannot run here; the outcome is a failed line and the record
    // is the ask that preceded it.
    await tts.speak('Here is what I found.', 'turn-3')

    expect(traced).toContainEqual({
      kind: 'tts_line',
      text: 'Here is what I found.',
      chars: 21,
      turnId: 'turn-3',
    })
  })

  it('is silent about lines when no writer was given', async () => {
    const tts = createMainTts({
      config: { bin: '/nonexistent/piper', voicesDir: '/nonexistent/voices', voiceId: 'test' },
      pane: DEAD_PANE,
      getVoiceId: () => 'test',
    })

    await expect(tts.speak('Here is what I found.')).resolves.toMatchObject({ ok: false })
  })
})
