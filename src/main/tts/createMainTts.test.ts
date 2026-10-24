import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { createMainTts } from './createMainTts'

const DEAD_PANE = { isDestroyed: () => true } as unknown as WebContents
const INSTALL = { piperDir: '/nonexistent/piper', voicesDir: '/nonexistent/voices', release: null }

describe('createMainTts', () => {
  it('resolves a failed line as an outcome, never a throw, when piper cannot run', async () => {
    const tts = createMainTts({
      config: { bin: '/nonexistent/piper', voicesDir: '/nonexistent/voices', voiceId: 'test', playerBin: '/nonexistent/aplay', install: INSTALL },
      pane: DEAD_PANE,
      getVoiceId: () => 'test',
    })

    await expect(tts.speak('Here is what I found.')).resolves.toMatchObject({ ok: false })
  })

  it('fails the line as an outcome when Piper could not be installed, and asks the install again at the next line (#419)', async () => {
    let installs = 0
    const tts = createMainTts({
      config: { bin: '/nonexistent/piper', voicesDir: '/nonexistent/voices', voiceId: 'test', playerBin: '/nonexistent/aplay', install: INSTALL },
      pane: DEAD_PANE,
      getVoiceId: () => 'test',
      ready: () => {
        installs += 1
        return Promise.reject(new Error('fetch https://github.com/… → HTTP 503'))
      },
    })

    await expect(tts.speak('Here is what I found.')).resolves.toMatchObject({ ok: false })
    await expect(tts.speak('And again.')).resolves.toMatchObject({ ok: false })
    expect(installs).toBe(2)
  })
})
