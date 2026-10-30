import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { createYtDlpUpdater, extractZip, SELF_CHECK_RANGE, SELF_CHECK_VIDEO, startYtDlpUpkeep, watchStreamFaults, type UpdateReason, type UpdaterFetch, type YtDlpUpdaterDeps } from './ytDlpUpdater'

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
  rmSync(`${dir}.path`, { recursive: true, force: true })
})

const sha = (bytes: string): string => createHash('sha256').update(bytes).digest('hex')

const LATEST = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS'

/** The fake release's zip holds the executable's contents: unpacking it writes them where the onedir's executable sits. */
const unpackFake = async (zip: string, into: string): Promise<void> => copyFileSync(zip, join(into, 'yt-dlp_linux'))
const updaterOfZip = (deps: YtDlpUpdaterDeps) => createYtDlpUpdater({ asset: 'yt-dlp_linux.zip', extract: unpackFake, ...deps })
/** The executable of the copy of a version. */
const copyOf = (version: string): string => join(dir, version, 'yt-dlp_linux')
/** What the dir holds: the state and one directory per copy kept. */
const held = (): string[] => readdirSync(dir).sort()

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
    if (url === `${release}/SHA2-256SUMS`) return reply(asset, 200, state.sums || `${sha(state.binary)}  yt-dlp_linux.zip\n${sha('other')}  yt-dlp_linux\n`)
    if (url === `${release}/yt-dlp_linux.zip`) return reply(asset, 200, state.binary)
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
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    expect(updater.binary()).toBeNull()
    expect(await updater.update('boot')).toEqual({ kind: 'updated', version: '2026.10.26' })
    expect(looked).toEqual([`#!fake yt-dlp 2026.10.26 ${SELF_CHECK_VIDEO}`])
    expect(updater.binary()).toBe(copyOf('2026.10.26'))
    expect(readFileSync(copyOf('2026.10.26'), 'utf8')).toBe('#!fake yt-dlp 2026.10.26')
    expect(held()).toEqual(['2026.10.26', 'state.json'])
  })

  it('a release whose stream is cut past 512 KB is never switched to, and the fault log names it', async () => {
    const { fetch, fetched, state } = world('2026.10.26')
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
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
    state.sums = `${sha('something else')}  yt-dlp_linux.zip\n`
    const looked: string[] = []
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    expect(await updater.update('boot')).toMatchObject({ kind: 'rejected', why: 'yt-dlp_linux.zip does not match its SHA2-256SUMS' })
    expect(looked).toEqual([])
    expect(updater.binary()).toBeNull()
    expect(held()).toEqual([])
  })

  it('the latest release already in use is not downloaded again', async () => {
    const { fetch, fetched } = world('2026.10.26')
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    fetched.length = 0
    expect(await updater.update('daily')).toEqual({ kind: 'current', version: '2026.10.26' })
    expect(fetched).toEqual([LATEST])
  })

  it('a copy in use that fails the self-check after a resolve failure is switched back from, to the previous copy', async () => {
    const { fetch, state } = world('2026.10.26')
    const looked: string[] = []
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    await updater.update('boot')
    state.tag = '2026.11.02'
    state.binary = '#!fake yt-dlp 2026.11.02'
    await updater.update('daily')
    expect(readFileSync(updater.binary()!, 'utf8')).toBe('#!fake yt-dlp 2026.11.02')
    state.cut.add('#!fake yt-dlp 2026.11.02')
    expect(await updater.update('failure')).toEqual({ kind: 'rolled-back', from: '2026.11.02', to: '2026.10.26' })
    expect(readFileSync(updater.binary()!, 'utf8')).toBe('#!fake yt-dlp 2026.10.26')
    expect(held()).toEqual(['2026.10.26', 'state.json'])
    expect(faults).toEqual([expect.objectContaining({ site: 'music.player.ytdlp', message: expect.stringMatching(/yt-dlp 2026\.11\.02 failed the self-check .*switched back to yt-dlp 2026\.10\.26/) })])
  })

  it('with no previous copy that passes, a failing copy in use gives way to the yt-dlp on PATH', async () => {
    const { fetch, state } = world('2026.10.26')
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    state.cut.add('#!fake yt-dlp 2026.10.26')
    expect(await updater.update('failure')).toEqual({ kind: 'rolled-back', from: '2026.10.26', to: null })
    expect(updater.binary()).toBeNull()
    expect(held()).toEqual(['state.json'])
  })

  it('a daily run does not self-check the copy in use: only a resolve failure does', async () => {
    const { fetch } = world('2026.10.26')
    const looked: string[] = []
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    await updater.update('boot')
    looked.length = 0
    await updater.update('daily')
    expect(looked).toEqual([])
    await updater.update('failure')
    expect(looked).toHaveLength(1)
  })

  /** The yt-dlp on PATH, as a file whose contents name its version: the fake lookup reads it as it reads the app's copies. */
  function onPath(version: string) {
    // Outside the updater's dir, as PATH's is: the dir holds only what the updater keeps.
    mkdirSync(`${dir}.path`, { recursive: true })
    const binary = join(`${dir}.path`, 'yt-dlp')
    writeFileSync(binary, `#!fake yt-dlp ${version}`)
    return { binary, version: async () => readFileSync(binary, 'utf8').split(' ').at(-1)! }
  }

  it("PATH's yt-dlp is kept while it is the latest release and passes the self-check: nothing is downloaded", async () => {
    const { fetch, fetched } = world('2026.10.26')
    const looked: string[] = []
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked), path: onPath('2026.10.26') })
    expect(await updater.update('boot')).toEqual({ kind: 'path', version: '2026.10.26' })
    expect(updater.binary()).toBeNull()
    expect(looked).toEqual([`#!fake yt-dlp 2026.10.26 ${SELF_CHECK_VIDEO}`])
    expect(fetched.filter((url) => url.startsWith('https://github.com/'))).toEqual([LATEST])
  })

  it("PATH's yt-dlp older than the latest release gives way to the app's copy, unchecked", async () => {
    const { fetch } = world('2026.11.02')
    const looked: string[] = []
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked), path: onPath('2026.10.26') })
    expect(await updater.update('daily')).toEqual({ kind: 'updated', version: '2026.11.02' })
    expect(updater.binary()).toBe(copyOf('2026.11.02'))
    expect(looked).toEqual([`#!fake yt-dlp 2026.11.02 ${SELF_CHECK_VIDEO}`])
  })

  it("PATH's latest yt-dlp failing the self-check gives way to the app's copy; once it passes again, it is used again", async () => {
    const { fetch, state } = world('2026.10.26', '#!fake yt-dlp app 2026.10.26')
    const path = onPath('2026.10.26')
    state.cut.add('#!fake yt-dlp 2026.10.26')
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]), path })
    expect(await updater.update('boot')).toEqual({ kind: 'updated', version: '2026.10.26' })
    expect(updater.binary()).toBe(copyOf('2026.10.26'))
    state.cut.clear()
    expect(await updater.update('daily')).toEqual({ kind: 'path', version: '2026.10.26' })
    expect(updater.binary()).toBeNull()
  })

  it("the choice of PATH's yt-dlp outlives a restart, until the next run", async () => {
    const { fetch } = world('2026.10.26')
    await updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]), path: onPath('2026.10.20') }).update('boot')
    const path = onPath('2026.10.26')
    await updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]), path }).update('daily')
    expect(updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]), path }).binary()).toBeNull()
  })

  it('a resolve failure during a run is not lost: the copy in use is checked once that run ends', async () => {
    const { fetch, state } = world('2026.10.26')
    const looked: string[] = []
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked) })
    await updater.update('boot')
    state.cut.add('#!fake yt-dlp 2026.10.26')
    const daily = updater.update('daily')
    const failure = updater.update('failure')
    expect(await daily).toEqual({ kind: 'current', version: '2026.10.26' })
    expect(await failure).toEqual({ kind: 'rolled-back', from: '2026.10.26', to: null })
  })

  it('a download that failed its checksum is downloaded again by the next run: a bad download is not a bad release', async () => {
    const { fetch, state, fetched } = world('2026.10.26')
    state.sums = `${sha('something else')}  yt-dlp_linux.zip\n`
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    await updater.update('boot')
    state.sums = ''
    fetched.length = 0
    expect(await updater.update('daily')).toEqual({ kind: 'updated', version: '2026.10.26' })
  })

  it('offline, the copy in use stays and the fault log says why', async () => {
    const updater = updaterOfZip({
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
    const updater = updaterOfZip({
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

  it('keeps two directories, the copy in use and the previous one: the one before goes', async () => {
    const { fetch, state } = world('2026.10.20')
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    for (const tag of ['2026.10.20', '2026.10.26', '2026.11.02']) {
      state.tag = tag
      state.binary = `#!fake yt-dlp ${tag}`
      expect(await updater.update('daily')).toEqual({ kind: 'updated', version: tag })
    }
    expect(held()).toEqual(['2026.10.26', '2026.11.02', 'state.json'])
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))).toEqual({ current: '2026.11.02', previous: '2026.10.26' })
  })

  it('a zip that cannot be unpacked is never run, and is downloaded again by the next run', async () => {
    const { fetch } = world('2026.10.26')
    const looked: string[] = []
    let broken = true
    const extract = async (zip: string, into: string): Promise<void> => {
      if (broken) throw new Error('unzip: bad zipfile offset')
      await unpackFake(zip, into)
    }
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents(looked), extract })
    expect(await updater.update('boot')).toMatchObject({ kind: 'rejected', why: 'it could not be unpacked (unzip: bad zipfile offset)' })
    expect(looked).toEqual([])
    expect(held()).toEqual([])
    broken = false
    expect(await updater.update('daily')).toEqual({ kind: 'updated', version: '2026.10.26' })
  })

  it("the first layout's single file is no copy: PATH's is used until a run unpacks one, and the file goes", async () => {
    writeFileSync(join(dir, 'yt-dlp'), '#!fake yt-dlp 2026.10.26')
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: '2026.10.26' }))
    const { fetch } = world('2026.10.26')
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    expect(updater.binary()).toBeNull()
    expect(await updater.update('boot')).toEqual({ kind: 'updated', version: '2026.10.26' })
    expect(held()).toEqual(['2026.10.26', 'state.json'])
  })

  it("the first layout's files and a crash's leftovers go even while PATH's yt-dlp is used; a previous copy outlives a lost current one", async () => {
    for (const file of ['yt-dlp', 'yt-dlp.previous', '2026.10.26.zip.part']) writeFileSync(join(dir, file), 'left')
    mkdirSync(join(dir, '2026.10.20'))
    writeFileSync(copyOf('2026.10.20'), '#!fake yt-dlp 2026.10.20')
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: '2026.10.26', previous: '2026.10.20' }))
    const { fetch } = world('2026.10.26')
    expect(await updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]), path: onPath('2026.10.26') }).update('boot')).toEqual({ kind: 'path', version: '2026.10.26' })
    expect(held()).toEqual(['2026.10.20', 'state.json'])
  })

  it('a latest release whose tag is not a version is not read as one, and names no directory', async () => {
    const location = 'https://github.com/yt-dlp/yt-dlp/releases/download/../SHA2-256SUMS'
    const fetch = (async (url: string) => ({ ok: false, status: 302, url, headers: new Headers({ location }), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) })) as UpdaterFetch
    const updater = updaterOfZip({ dir, on: () => true, fetch, lookup: lookupByContents([]) })
    expect(await updater.update('boot')).toMatchObject({ kind: 'unavailable' })
    expect(held()).toEqual([])
  })

  it('with the road off, nothing is downloaded or run', async () => {
    const fetched: string[] = []
    const looked: string[] = []
    const updater = updaterOfZip({
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

const hasZip = ((): boolean => {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasZip)("unpacking the release's onedir zip (#503)", () => {
  it('unpacks the executable beside its _internal/, with its mode', async () => {
    const source = join(dir, 'source')
    mkdirSync(join(source, '_internal'), { recursive: true })
    writeFileSync(join(source, 'yt-dlp_linux'), '#!/bin/sh\n', { mode: 0o755 })
    writeFileSync(join(source, '_internal', 'base_library.zip'), 'x')
    execFileSync('zip', ['-qr', join(dir, 'release.zip'), '.'], { cwd: source })
    mkdirSync(join(dir, 'into'))
    await extractZip(join(dir, 'release.zip'), join(dir, 'into'))
    expect(readdirSync(join(dir, 'into')).sort()).toEqual(['_internal', 'yt-dlp_linux'])
    expect(statSync(join(dir, 'into', 'yt-dlp_linux')).mode & 0o111).not.toBe(0)
  })

  it('with neither unzip nor bsdtar installed, says so', async () => {
    writeFileSync(join(dir, 'release.zip'), 'not a zip')
    const path = process.env.PATH
    process.env.PATH = join(dir, 'no-tools')
    try {
      await expect(extractZip(join(dir, 'release.zip'), dir)).rejects.toThrow(/neither unzip nor bsdtar is installed/)
    } finally {
      process.env.PATH = path
    }
  })

  it('a zip that is not one is refused, not half unpacked', async () => {
    writeFileSync(join(dir, 'release.zip'), 'not a zip')
    mkdirSync(join(dir, 'into'))
    await expect(extractZip(join(dir, 'release.zip'), join(dir, 'into'))).rejects.toThrow(/could not unpack/)
  })
})

describe('a stream refused counts against the yt-dlp, unless its address was remembered (#503, #516)', () => {
  function watched(remembered: boolean) {
    const heard: { completed?: (details: { statusCode: number }) => void; errored?: (details: { error: string }) => void } = {}
    let failures = 0
    watchStreamFaults(
      {
        onCompleted: (_filter, listener) => void (heard.completed = listener),
        onErrorOccurred: (_filter, listener) => void (heard.errored = listener),
      },
      () => remembered,
      () => (failures += 1),
    )
    return { heard, failures: () => failures }
  }

  it('a 403 on a looked-up stream is a failure; a 206 is not', () => {
    const { heard, failures } = watched(false)
    heard.completed!({ statusCode: 206 })
    expect(failures()).toBe(0)
    heard.completed!({ statusCode: 403 })
    expect(failures()).toBe(1)
  })

  it('a stream cut off is a failure; one the element let go is not', () => {
    const { heard, failures } = watched(false)
    heard.errored!({ error: 'net::ERR_ABORTED' })
    expect(failures()).toBe(0)
    heard.errored!({ error: 'net::ERR_CONNECTION_RESET' })
    expect(failures()).toBe(1)
  })

  it('neither counts on a remembered address', () => {
    const { heard, failures } = watched(true)
    heard.completed!({ statusCode: 403 })
    heard.errored!({ error: 'net::ERR_CONNECTION_RESET' })
    expect(failures()).toBe(0)
  })
})
