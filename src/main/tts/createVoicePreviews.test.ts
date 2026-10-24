import { describe, expect, it } from 'vitest'
import type { AudioPlayback, AudioPlayer } from '../../core/ports/tts'
import { createVoicePreviews } from './createVoicePreviews'

// The settings picker's ▶ (#412): each voice's clip of the one sample line,
// shipped with the app or rendered once through the real synthesizer and
// kept; one preview at a time.

function fakePlayer() {
  const plays: { wav: string; stopped: boolean; finish(): void }[] = []
  const player: AudioPlayer = {
    play(wav) {
      let finish!: () => void
      const done = new Promise<void>((resolve) => (finish = resolve))
      const entry = { wav: new TextDecoder().decode(wav), stopped: false, finish }
      plays.push(entry)
      const playback: AudioPlayback = {
        done,
        stop() {
          entry.stopped = true
          finish()
        },
      }
      return playback
    },
  }
  return { player, plays }
}

function fakeFiles(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial))
  return {
    files,
    read: async (path: string) => {
      const text = files.get(path)
      if (text === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' })
      return new TextEncoder().encode(text)
    },
    write: async (path: string, bytes: Uint8Array) => {
      files.set(path, new TextDecoder().decode(bytes))
    },
  }
}

describe('createVoicePreviews', () => {
  it('plays the shipped clip of a voice', async () => {
    const { player, plays } = fakePlayer()
    const fs = fakeFiles({ '/app/samples/kokoro-af_heart.wav': 'heart' })
    const previews = createVoicePreviews({ samplesDir: '/app/samples', cacheDir: '/data/previews', player, render: async () => new Uint8Array(), readFile: fs.read, writeFile: fs.write })

    const outcome = previews.play('kokoro:af_heart')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(plays.map((play) => play.wav)).toEqual(['heart'])
    plays[0]!.finish()
    expect(await outcome).toEqual({ ok: true })
  })

  it('renders a voice with no clip through the synthesizer once, and keeps it', async () => {
    const { player, plays } = fakePlayer()
    const fs = fakeFiles({})
    const rendered: string[] = []
    const previews = createVoicePreviews({
      samplesDir: '/app/samples',
      cacheDir: '/data/previews',
      player,
      render: async (voiceId) => (rendered.push(voiceId), new TextEncoder().encode(`render ${voiceId}`)),
      readFile: fs.read,
      writeFile: fs.write,
    })

    const first = previews.play('en_US-amy-low')
    await new Promise((resolve) => setTimeout(resolve, 0))
    plays[0]!.finish()
    await first
    const second = previews.play('en_US-amy-low')
    await new Promise((resolve) => setTimeout(resolve, 0))
    plays[1]!.finish()
    await second

    expect(rendered).toEqual(['en_US-amy-low'])
    expect(fs.files.get('/data/previews/en_US-amy-low.wav')).toBe('render en_US-amy-low')
    expect(plays.map((play) => play.wav)).toEqual(['render en_US-amy-low', 'render en_US-amy-low'])
  })

  it('stops the preview playing when another starts, and when told to stop', async () => {
    const { player, plays } = fakePlayer()
    const fs = fakeFiles({ '/app/samples/a.wav': 'a', '/app/samples/b.wav': 'b' })
    const previews = createVoicePreviews({ samplesDir: '/app/samples', cacheDir: '/data/previews', player, render: async () => new Uint8Array(), readFile: fs.read, writeFile: fs.write })

    const a = previews.play('a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const b = previews.play('b')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(plays.map((play) => [play.wav, play.stopped])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(await a).toEqual({ ok: true, stopped: true })
    previews.stop()
    expect(await b).toEqual({ ok: true, stopped: true })
  })

  it('never plays a clip whose preview was stopped while it rendered', async () => {
    const { player, plays } = fakePlayer()
    const fs = fakeFiles({})
    let finishRender!: (wav: Uint8Array) => void
    const previews = createVoicePreviews({
      samplesDir: '/app/samples',
      cacheDir: '/data/previews',
      player,
      render: () => new Promise((resolve) => (finishRender = resolve)),
      readFile: fs.read,
      writeFile: fs.write,
    })

    const outcome = previews.play('slow')
    await new Promise((resolve) => setTimeout(resolve, 0))
    previews.stop()
    finishRender(new TextEncoder().encode('late'))
    expect(await outcome).toEqual({ ok: true, stopped: true })
    expect(plays).toEqual([])
  })

  it('says why a voice cannot be previewed', async () => {
    const { player } = fakePlayer()
    const fs = fakeFiles({})
    const previews = createVoicePreviews({
      samplesDir: '/app/samples',
      cacheDir: '/data/previews',
      player,
      render: async () => {
        throw new Error('the Kokoro voice af_sky is not fetched yet')
      },
      readFile: fs.read,
      writeFile: fs.write,
    })

    expect(await previews.play('kokoro:af_sky')).toEqual({ ok: false, error: 'the Kokoro voice af_sky is not fetched yet' })
  })
})
