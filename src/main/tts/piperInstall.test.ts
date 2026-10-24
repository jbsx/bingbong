import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensurePiper, PIPER_VOICE_FILES, piperReleaseFor, type PiperInstallDeps } from './piperInstall'

/** A fake disk and network: what exists, at what size, and every fetch, extract and move made. */
function fakeDeps(present: Record<string, number> = {}): PiperInstallDeps & { calls: string[] } {
  const files = new Map(Object.entries(present))
  const calls: string[] = []
  return {
    calls,
    store: {
      exists: (path) => files.has(path),
      size: (path) => files.get(path) ?? 0,
      async fetch(url, dest) {
        calls.push(`fetch ${url} -> ${dest}`)
        files.set(dest, 1e9)
      },
    },
    async extract(archive, intoDir) {
      calls.push(`extract ${archive} -> ${intoDir}`)
      files.set(join(intoDir, 'piper', 'piper'), 5e6)
    },
    async move(from, to) {
      calls.push(`move ${from} -> ${to}`)
      files.set(to, files.get(join(from, 'piper')) ?? 0)
      files.set(join(to, 'piper'), files.get(join(from, 'piper')) ?? 0)
    },
    async remove(path) {
      calls.push(`remove ${path}`)
      files.delete(path)
    },
  }
}

const RELEASE = piperReleaseFor('linux', 'x64')!
const PLAN = { piperDir: '/data/piper', voicesDir: '/data/voices', release: RELEASE }

describe('ensurePiper', () => {
  it('names the rhasspy Linux x86_64 release and no other platform yet (the Mac build is later)', () => {
    expect(RELEASE.url).toBe('https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz')
    expect(piperReleaseFor('darwin', 'arm64')).toBeNull()
    expect(piperReleaseFor('linux', 'arm64')).toBeNull()
  })

  it('on a fresh profile downloads the binary and the alba voice, the binary unpacked aside and moved into place', async () => {
    const deps = fakeDeps()
    const installed = await ensurePiper(PLAN, deps)

    expect(installed).toEqual({ bin: '/data/piper/piper/piper', fetched: ['piper', 'en_GB-alba-medium.onnx', 'en_GB-alba-medium.onnx.json'] })
    expect(deps.calls).toEqual([
      `fetch ${RELEASE.url} -> /data/piper/piper.tar.gz`,
      'remove /data/piper/unpacking',
      'extract /data/piper/piper.tar.gz -> /data/piper/unpacking',
      'move /data/piper/unpacking/piper -> /data/piper/piper',
      'remove /data/piper/unpacking',
      'remove /data/piper/piper.tar.gz',
      `fetch ${PIPER_VOICE_FILES[0]!.url} -> /data/voices/en_GB-alba-medium.onnx`,
      `fetch ${PIPER_VOICE_FILES[1]!.url} -> /data/voices/en_GB-alba-medium.onnx.json`,
    ])
  })

  it('fetches nothing when the binary and both voice files are already whole', async () => {
    const deps = fakeDeps({
      '/data/piper/piper/piper': 5e6,
      '/data/voices/en_GB-alba-medium.onnx': 63e6,
      '/data/voices/en_GB-alba-medium.onnx.json': 4888,
    })
    expect(await ensurePiper(PLAN, deps)).toEqual({ bin: '/data/piper/piper/piper', fetched: [] })
    expect(deps.calls).toEqual([])
  })

  it('refetches a voice cut short', async () => {
    const deps = fakeDeps({
      '/data/piper/piper/piper': 5e6,
      '/data/voices/en_GB-alba-medium.onnx': 1e6,
      '/data/voices/en_GB-alba-medium.onnx.json': 4888,
    })
    expect((await ensurePiper(PLAN, deps)).fetched).toEqual(['en_GB-alba-medium.onnx'])
  })

  it("installs nothing when the binary is not the app's: BINGBONG_PIPER_BIN, or piper on PATH, brings its own voices", async () => {
    const deps = fakeDeps()
    expect(await ensurePiper({ ...PLAN, release: null }, deps)).toEqual({ bin: null, fetched: [] })
    expect(deps.calls).toEqual([])
  })
})
