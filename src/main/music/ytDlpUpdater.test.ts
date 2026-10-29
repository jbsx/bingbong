import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { createYtDlpUpdater, SELF_CHECK_RANGE, SELF_CHECK_VIDEO, startYtDlpUpkeep, type UpdateReason, type UpdaterFetch } from './ytDlpUpdater'

let dir: string
let faults: FaultReport[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ytdlp-updater-'))
  faults = []
  setFaultSink((report) => faults.push(report))
})
afterEach(() => {
  setFaultSink(null)
  rmSync(dir, { recursive: true, force: true })
})

const sha = (bytes: string): string => createHash('sha256').update(bytes).digest('hex')

const LATEST = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS'

/**
 * GitHub's yt-dlp releases with one latest tag, as GitHub serves them: the
 * latest's checksums redirect to the tag's, which redirect again to an asset
 * host that names no tag. And the stream a lookup names: a 206 of the whole
 * range, unless cut.
 */
function world(tag: string, binary = `#!fake yt-dlp ${tag}`) {
  const fetched: string[] = []
  const state = { tag, binary, sums: '', cut: new Set<string>() }
  const reply = (url: string, status: number, body: string, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(headers),
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })
  const fetch = (async (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
    fetched.push(url)
    const release = `https://github.com/yt-dlp/yt-dlp/releases/download/${state.tag}`
    const asset = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc'
    if (url === LATEST) {
      return init?.redirect === 'manual' ? reply(url, 302, '', { location: `${release}/SHA2-256SUMS` }) : reply(asset, 200, '')
    }
    if (url === `${release}/SHA2-256SUMS`) return reply(asset, 200, state.sums || `${sha(state.binary)}  yt-dlp_linux\n${sha('other')}  yt-dlp.exe\n`)
    if (url === `${release}/yt-dlp_linux`) return reply(asset, 200, state.binary)
    if (url.startsWith('https://stream.example/')) {
      const [from, to] = SELF_CHECK_RANGE
      if (state.cut.has(decodeURIComponent(url.slice('https://stream.example/'.length))) || init?.headers?.Range !== `bytes=${from}-${to}`) return reply(url, 403, '')
      return reply(url, 206, 'x'.repeat(to - from + 1), { 'content-range': `bytes ${from}-${to}/4000000` })
    }
    return reply(url, 404, '')
  }) as UpdaterFetch
  return { fetched, state, fetch }
}

/** A lookup that reads the binary it was given: its contents name its stream. */
const lookupByContents = (looked: string[]) => async (binary: string, id: string) => {
  const contents = readFileSync(binary, 'utf8')
  looked.push(`${contents} ${id}`)
  return { stream: `https://stream.example/${encodeURIComponent(contents)}`, availableAt: null }
}

describe("the app's own yt-dlp's schedule (#503)", () => {
  function counting() {
    const runs: UpdateReason[] = []
    return { runs, updater: { binary: () => null, update: async (reason: UpdateReason) => (runs.push(reason), { kind: 'off' as const }) } }
  }

  it('runs once the app is up, then once a day', async () => {
    vi.useFakeTimers()
    try {
      const { runs, updater } = counting()
      let up: () => void = () => {}
      const upkeep = startYtDlpUpkeep(updater, new Promise<void>((resolve) => (up = resolve)))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(runs).toEqual([])
      up()
      await vi.advanceTimersByTimeAsync(0)
      expect(runs).toEqual(['boot'])
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(runs).toEqual(['boot', 'daily'])
      upkeep.stop()
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(runs).toEqual(['boot', 'daily'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resolve failure starts a run at most once an hour', async () => {
    let clock = 0
    const { runs, updater } = counting()
    const upkeep = startYtDlpUpkeep(updater, new Promise<void>(() => {}), () => clock)
    upkeep.failed()
    upkeep.failed()
    clock += 59 * 60_000
    upkeep.failed()
    expect(runs).toEqual(['failure'])
    clock += 60_000
    upkeep.failed()
    expect(runs).toEqual(['failure', 'failure'])
    upkeep.stop()
  })
})

describe("the app's own yt-dlp (#503)", () => {
  it('a stale or missing copy is replaced by the latest release once it passes the self-check', async () => {
    const { fetch } = world('2026.10.26')
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    expect(updater.binary()).toBeNull()
    expect(await updater.update('boot')).toEqual({ kind: 'updated', version: '2026.10.26' })
    expect(looked).toEqual([`#!fake yt-dlp 2026.10.26 ${SELF_CHECK_VIDEO}`])
    expect(updater.binary()).toBe(join(dir, 'yt-dlp'))
    expect(readFileSync(join(dir, 'yt-dlp'), 'utf8')).toBe('#!fake yt-dlp 2026.10.26')
    expect(existsSync(join(dir, 'yt-dlp.candidate'))).toBe(false)
  })

  it('a release whose stream is cut past 512 KB is never switched to, and the fault log names it', async () => {
    const { fetch, fetched, state } = world('2026.10.26')
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    state.tag = '2026.11.02'
    state.binary = '#!fake yt-dlp 2026.11.02'
    state.cut.add(state.binary)
    const outcome = await updater.update('daily')
    expect(outcome).toMatchObject({ kind: 'rejected', version: '2026.11.02' })
    expect(readFileSync(updater.binary()!, 'utf8')).toBe('#!fake yt-dlp 2026.10.26')
    expect(faults).toEqual([expect.objectContaining({ site: 'music.player.ytdlp', message: expect.stringMatching(/yt-dlp 2026\.11\.02 is not used: it failed the self-check \(the stream answered 403/) })])
    // Not tried again within the day: nothing more is downloaded.
    fetched.length = 0
    expect(await updater.update('daily')).toMatchObject({ kind: 'rejected', version: '2026.11.02' })
    expect(fetched).toEqual([LATEST])
  })

  it('a download that does not match its SHA2-256SUMS is never run', async () => {
    const { fetch, state } = world('2026.10.26')
    state.sums = `${sha('something else')}  yt-dlp_linux\n`
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    expect(await updater.update('boot')).toMatchObject({ kind: 'rejected', why: 'yt-dlp_linux does not match its SHA2-256SUMS' })
    expect(looked).toEqual([])
    expect(updater.binary()).toBeNull()
    expect(existsSync(join(dir, 'yt-dlp.candidate'))).toBe(false)
  })

  it('the latest release already in use is not downloaded again', async () => {
    const { fetch, fetched } = world('2026.10.26')
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    fetched.length = 0
    expect(await updater.update('daily')).toEqual({ kind: 'current', version: '2026.10.26' })
    expect(fetched).toEqual([LATEST])
  })

  it('a copy in use that fails the self-check after a resolve failure is switched back from, to the previous copy', async () => {
    const { fetch, state } = world('2026.10.26')
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    await updater.update('boot')
    state.tag = '2026.11.02'
    state.binary = '#!fake yt-dlp 2026.11.02'
    await updater.update('daily')
    expect(readFileSync(updater.binary()!, 'utf8')).toBe('#!fake yt-dlp 2026.11.02')
    state.cut.add('#!fake yt-dlp 2026.11.02')
    expect(await updater.update('failure')).toEqual({ kind: 'rolled-back', from: '2026.11.02', to: '2026.10.26' })
    expect(readFileSync(updater.binary()!, 'utf8')).toBe('#!fake yt-dlp 2026.10.26')
    expect(faults).toEqual([expect.objectContaining({ site: 'music.player.ytdlp', message: expect.stringMatching(/yt-dlp 2026\.11\.02 failed the self-check .*switched back to yt-dlp 2026\.10\.26/) })])
  })

  it('with no previous copy that passes, a failing copy in use gives way to the yt-dlp on PATH', async () => {
    const { fetch, state } = world('2026.10.26')
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    state.cut.add('#!fake yt-dlp 2026.10.26')
    expect(await updater.update('failure')).toEqual({ kind: 'rolled-back', from: '2026.10.26', to: null })
    expect(updater.binary()).toBeNull()
  })

  it('a daily run does not self-check the copy in use: only a resolve failure does', async () => {
    const { fetch } = world('2026.10.26')
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    await updater.update('boot')
    looked.length = 0
    await updater.update('daily')
    expect(looked).toEqual([])
    await updater.update('failure')
    expect(looked).toHaveLength(1)
  })

  /** The yt-dlp on PATH, as a file whose contents name its version: the fake lookup reads it as it reads the app's copies. */
  function onPath(version: string) {
    const binary = join(dir, `path-yt-dlp`)
    writeFileSync(binary, `#!fake yt-dlp ${version}`)
    return { binary, version: async () => readFileSync(binary, 'utf8').split(' ').at(-1)! }
  }

  it("PATH's yt-dlp is kept while it is the latest release and passes the self-check: nothing is downloaded", async () => {
    const { fetch, fetched } = world('2026.10.26')
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked), path: onPath('2026.10.26') })
    expect(await updater.update('boot')).toEqual({ kind: 'path', version: '2026.10.26' })
    expect(updater.binary()).toBeNull()
    expect(looked).toEqual([`#!fake yt-dlp 2026.10.26 ${SELF_CHECK_VIDEO}`])
    expect(fetched.filter((url) => url.startsWith('https://github.com/'))).toEqual([LATEST])
  })

  it("PATH's yt-dlp older than the latest release gives way to the app's copy, unchecked", async () => {
    const { fetch } = world('2026.11.02')
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked), path: onPath('2026.10.26') })
    expect(await updater.update('daily')).toEqual({ kind: 'updated', version: '2026.11.02' })
    expect(updater.binary()).toBe(join(dir, 'yt-dlp'))
    expect(looked).toEqual([`#!fake yt-dlp 2026.11.02 ${SELF_CHECK_VIDEO}`])
  })

  it("PATH's latest yt-dlp failing the self-check gives way to the app's copy; once it passes again, it is used again", async () => {
    const { fetch, state } = world('2026.10.26', '#!fake yt-dlp app 2026.10.26')
    const path = onPath('2026.10.26')
    state.cut.add('#!fake yt-dlp 2026.10.26')
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]), path })
    expect(await updater.update('boot')).toEqual({ kind: 'updated', version: '2026.10.26' })
    expect(updater.binary()).toBe(join(dir, 'yt-dlp'))
    state.cut.clear()
    expect(await updater.update('daily')).toEqual({ kind: 'path', version: '2026.10.26' })
    expect(updater.binary()).toBeNull()
  })

  it("the choice of PATH's yt-dlp outlives a restart, until the next run", async () => {
    const { fetch } = world('2026.10.26')
    await createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]), path: onPath('2026.10.20') }).update('boot')
    const path = onPath('2026.10.26')
    await createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]), path }).update('daily')
    expect(createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]), path }).binary()).toBeNull()
  })

  it('a resolve failure during a run is not lost: the copy in use is checked once that run ends', async () => {
    const { fetch, state } = world('2026.10.26')
    const looked: string[] = []
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    await updater.update('boot')
    state.cut.add('#!fake yt-dlp 2026.10.26')
    const daily = updater.update('daily')
    const failure = updater.update('failure')
    expect(await daily).toEqual({ kind: 'current', version: '2026.10.26' })
    expect(await failure).toEqual({ kind: 'rolled-back', from: '2026.10.26', to: null })
  })

  it('a download that failed its checksum is downloaded again by the next run: a bad download is not a bad release', async () => {
    const { fetch, state, fetched } = world('2026.10.26')
    state.sums = `${sha('something else')}  yt-dlp_linux\n`
    const updater = createYtDlpUpdater({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    state.sums = ''
    fetched.length = 0
    expect(await updater.update('daily')).toEqual({ kind: 'updated', version: '2026.10.26' })
  })

  it('offline, the copy in use stays and the fault log says why', async () => {
    const updater = createYtDlpUpdater({
      dir,
      on: () => true,
      fetch: (async () => {
        throw new Error('getaddrinfo ENOTFOUND github.com')
      }) as UpdaterFetch,
      lookup: lookupByContents([]),
    })
    expect(await updater.update('boot')).toEqual({ kind: 'unavailable', why: 'getaddrinfo ENOTFOUND github.com' })
    expect(faults).toEqual([expect.objectContaining({ site: 'music.player.ytdlp' })])
  })

  it('waits out the stream until YouTube serves it before fetching the range', async () => {
    const { fetch } = world('2026.10.26')
    const slept: number[] = []
    const updater = createYtDlpUpdater({
      dir,
      on: () => true,
      fetch,
      now: () => 1_000_000,
      sleep: async (ms) => {
        slept.push(ms)
      },
      lookup: async (binary, id) => ({ ...(await lookupByContents([])(binary, id)), availableAt: 1_002_700 }),
    })
    expect(await updater.update('boot')).toMatchObject({ kind: 'updated' })
    expect(slept).toEqual([3_200])
  })

  it('with the road off, nothing is downloaded or run', async () => {
    const fetched: string[] = []
    const looked: string[] = []
    const updater = createYtDlpUpdater({
      dir,
      on: () => false,
      fetch: (async (url: string) => {
        fetched.push(url)
        throw new Error('no fetch')
      }) as UpdaterFetch,
      lookup: async (binary) => {
        looked.push(binary)
        throw new Error('no lookup')
      },
    })
    expect(await updater.update('boot')).toEqual({ kind: 'off' })
    expect(fetched).toEqual([])
    expect(looked).toEqual([])
    expect(updater.binary()).toBeNull()
  })
})
