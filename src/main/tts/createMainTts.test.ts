import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { createMainTts } from './createMainTts'

const DEAD_PANE = { isDestroyed: () => true } as unknown as WebContents

describe('createMainTts', () => {
  it('resolves a failed line as an outcome, never a throw, when piper cannot run', async () => {
    const tts = createMainTts({
      config: { bin: '/nonexistent/piper', voicesDir: '/nonexistent/voices', voiceId: 'test' },
      pane: DEAD_PANE,
      getVoiceId: () => 'test',
    })

    await expect(tts.speak('Here is what I found.')).resolves.toMatchObject({ ok: false })
  })
})
