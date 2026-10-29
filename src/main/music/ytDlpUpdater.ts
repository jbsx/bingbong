import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { reportFault } from '../../core/trace/fault'
import type { AudioStream } from './ytDlp'

// The app's own yt-dlp (#503): YouTube changes its scheme often and a stale
// yt-dlp fails quietly — on 2026-10-28 a 2026.07.04 build's streams were
// refused (403) past their first 512 KB, a song that starts and then stops.
// So the app keeps a copy of yt-dlp's standalone release binary in userData,
// where it can replace it without sudo (ruling 1 on #503): the release's
// SHA2-256SUMS is checked before it is ever run, and a copy is used only
// once it has passed the self-check; until then the yt-dlp on PATH is. The
// previous copy is kept, and a copy that fails the self-check is never
// switched to, or is switched back from (ruling 4). Everything here runs
// in the background, behind the road's own switch: never on a Command's path.

/** Where releases come from: the public yt-dlp/yt-dlp GitHub releases, nowhere else. */
const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases'
/** The latest release's checksums: GitHub redirects to the tag's own, which names the version. */
const LATEST_SUMS = `${RELEASES}/latest/download/SHA2-256SUMS`

/** The standalone release binary for this machine's architecture; null where yt-dlp ships none, and PATH's is used. */
export function releaseAsset(arch: string = process.arch): string | null {
  return arch === 'x64' ? 'yt-dlp_linux' : arch === 'arm64' ? 'yt-dlp_linux_aarch64' : null
}

/**
 * The self-check's video (ruling 3): Blender's "Big Buck Bunny", public on
 * the Blender Foundation's own channel since 2014 and under a free licence,
 * so it is not taken down; ten minutes long, so its audio stream runs well
 * past the range fetched. A short video ("Me at the zoo", 19 s) has less
 * audio than the range and could not show the 512 KB cut.
 */
export const SELF_CHECK_VIDEO = 'aqz-KE-bpKQ'
/** The bytes fetched: the 512 KB after the first 512 KB, where a stale build's streams were cut (2026-10-28). */
export const SELF_CHECK_RANGE: readonly [number, number] = [512 * 1024, 1024 * 1024 - 1]
/** A lookup in the background may take longer than a song's (11 s): the kiosk is busy at boot. */
const SELF_CHECK_LOOKUP_MS = 30_000
/** The longest the self-check waits for the stream's `available_at` (about 2.7 s measured on #502). */
const SELF_CHECK_SERVED_MS = 15_000
/** The fetch of the range, and of a release file. */
const SELF_CHECK_FETCH_MS = 30_000
const DOWNLOAD_MS = 5 * 60_000
/** A release that failed the self-check is not tried again for a day, unless a newer one comes out. */
const REJECTED_FOR_MS = 24 * 60 * 60_000

/** The slice of `fetch` the updater uses: a fake in the tests. */
export type UpdaterFetch = (url: string, init?: { headers?: Record<string, string>; redirect?: 'follow' | 'manual'; signal?: AbortSignal }) => Promise<Pick<Response, 'ok' | 'status' | 'url' | 'headers' | 'text' | 'arrayBuffer'>>

export interface YtDlpUpdaterDeps {
  /** Where the app's copies live: userData's `yt-dlp/`. */
  readonly dir: string
  /** The road's own switch (#502 ruling 2), read at each run: off, nothing is downloaded or run. */
  on(): boolean
  readonly fetch: UpdaterFetch
  /** The road's lookup, run on a given binary: `resolveAudioStream`. */
  lookup(binary: string, id: string, timeoutMs: number): Promise<AudioStream>
  /** The release binary's name; `releaseAsset()` by default. */
  readonly asset?: string | null
  now?(): number
  sleep?(ms: number): Promise<void>
}

export type UpdateReason = 'boot' | 'daily' | 'failure'

export type UpdateOutcome =
  | { readonly kind: 'off' }
  /** The copy in use is the latest release. */
  | { readonly kind: 'current'; readonly version: string }
  | { readonly kind: 'updated'; readonly version: string }
  /** The latest release failed its checksum or the self-check, and the copy in use stays. */
  | { readonly kind: 'rejected'; readonly version: string; readonly why: string }
  /** The copy in use failed the self-check: switched back to the previous copy, or to PATH's with none that passes. */
  | { readonly kind: 'rolled-back'; readonly from: string; readonly to: string | null }
  /** No release could be read (offline, GitHub down), or none ships for this machine. */
  | { readonly kind: 'unavailable'; readonly why: string }

export interface YtDlpUpdater {
  /** The app's copy, once one has passed the self-check; null while none has, and the one on PATH is used. */
  binary(): string | null
  /** One run: the latest release fetched and checked if it is newer; on a resolve failure the copy in use is checked too. Runs never overlap. */
  update(reason: UpdateReason): Promise<UpdateOutcome>
}

/** What the dir holds besides the binaries: which version each is, and the last release rejected. */
interface UpdaterState {
  current?: string
  previous?: string
  rejected?: { version: string; at: number }
}

/** The version a release URL names: `…/releases/download/<tag>/…`. */
export function releaseTag(url: string): string | null {
  return /\/releases\/download\/([^/]+)\//.exec(url)?.[1] ?? null
}

/** The checksum SHA2-256SUMS gives a file. */
export function checksumOf(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+\*?/)
    if (name === file && hash !== undefined && /^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase()
  }
  return null
}

/** A day between runs (ruling 2 on #503). */
export const UPDATE_EVERY_MS = 24 * 60 * 60_000
/** At most one run an hour for resolve failures: a song YouTube refuses for its own reasons is not a stale yt-dlp. */
export const FAILURE_DEBOUNCE_MS = 60 * 60_000

export interface YtDlpUpkeep {
  /** A song's lookup failed, its stream was refused or cut: a run, unless one was started for a failure within the hour. Never waited on. */
  failed(): void
  stop(): void
}

/**
 * When the updater runs (ruling 2): in the background once the app is up,
 * then once a day, and on a resolve failure debounced to once an hour. No
 * line waits on a run: the failing song falls back to its watch page as
 * before, and the next song takes whichever copy passed.
 */
export function startYtDlpUpkeep(updater: YtDlpUpdater, up: Promise<void>, now: () => number = Date.now): YtDlpUpkeep {
  let daily: ReturnType<typeof setInterval> | null = null
  let stopped = false
  let lastFailureRun = -Infinity
  // The updater reports its own faults; a run that throws is a bug, logged the same way.
  const run = (reason: UpdateReason): void => void updater.update(reason).catch((error: unknown) => reportFault('music.player.ytdlp', error))
  void up.then(() => {
    if (stopped) return
    run('boot')
    daily = setInterval(() => run('daily'), UPDATE_EVERY_MS)
  })
  return {
    failed() {
      if (stopped || now() - lastFailureRun < FAILURE_DEBOUNCE_MS) return
      lastFailureRun = now()
      run('failure')
    },
    stop() {
      stopped = true
      if (daily !== null) clearInterval(daily)
    },
  }
}

export function createYtDlpUpdater(deps: YtDlpUpdaterDeps): YtDlpUpdater {
  const asset = deps.asset === undefined ? releaseAsset() : deps.asset
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const current = join(deps.dir, 'yt-dlp')
  const previous = join(deps.dir, 'yt-dlp.previous')
  const candidate = join(deps.dir, 'yt-dlp.candidate')
  const stateFile = join(deps.dir, 'state.json')
  let running: Promise<UpdateOutcome> | null = null

  /** No state yet is no copy; a state that cannot be read is no copy either, and PATH's is used until the next run writes one. */
  function readState(): UpdaterState {
    if (!existsSync(stateFile)) return {}
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8')) as UpdaterState
    } catch (error) {
      reportFault('music.player.ytdlp', error)
      return {}
    }
  }
  function writeState(state: UpdaterState): void {
    writeFileSync(stateFile, `${JSON.stringify(state)}\n`)
  }

  /**
   * The self-check (ruling 3): the binary resolves the stable video, then a
   * range past the first 512 KB of its stream is fetched. Only a 206 with
   * the whole range passes; a lookup that only returns an address proves
   * nothing. The bytes are counted and dropped: nothing is ever played.
   * Null on a pass, else why it failed.
   */
  async function selfCheck(binary: string): Promise<string | null> {
    let stream: AudioStream
    try {
      stream = await deps.lookup(binary, SELF_CHECK_VIDEO, SELF_CHECK_LOOKUP_MS)
    } catch (error) {
      return `the lookup failed: ${error instanceof Error ? error.message : String(error)}`
    }
    // The stream answers 403 until YouTube serves it (#502).
    if (stream.availableAt !== null) await sleep(Math.min(SELF_CHECK_SERVED_MS, Math.max(0, stream.availableAt + 500 - now())))
    const [from, to] = SELF_CHECK_RANGE
    try {
      const response = await deps.fetch(stream.stream, { headers: { Range: `bytes=${from}-${to}` }, signal: AbortSignal.timeout(SELF_CHECK_FETCH_MS) })
      if (response.status !== 206) return `the stream answered ${response.status} to bytes ${from}-${to}`
      const length = (await response.arrayBuffer()).byteLength
      if (length !== to - from + 1) return `the stream sent ${length} of bytes ${from}-${to}`
      return null
    } catch (error) {
      return `the stream's range could not be fetched: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async function fetchOk(url: string): Promise<Awaited<ReturnType<UpdaterFetch>>> {
    const response = await deps.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return response
  }

  /** The copy in use, checked again on a resolve failure: failing, the previous copy if it passes, else PATH's. */
  async function recheckCurrent(state: UpdaterState): Promise<UpdateOutcome | null> {
    if (state.current === undefined || !existsSync(current)) return null
    const failed = await selfCheck(current)
    if (failed === null) return null
    const from = state.current
    let to: string | null = null
    if (state.previous !== undefined && existsSync(previous) && (await selfCheck(previous)) === null) {
      renameSync(previous, current)
      to = state.previous
    } else {
      rmSync(current, { force: true })
      rmSync(previous, { force: true })
    }
    writeState({ ...(to === null ? {} : { current: to }), rejected: { version: from, at: now() } })
    reportFault('music.player.ytdlp', new Error(`yt-dlp ${from} failed the self-check (${failed}): switched back to ${to === null ? "the yt-dlp on PATH" : `yt-dlp ${to}`}`))
    return { kind: 'rolled-back', from, to }
  }

  async function run(reason: UpdateReason): Promise<UpdateOutcome> {
    if (!deps.on()) return { kind: 'off' }
    if (asset === null) return { kind: 'unavailable', why: `yt-dlp ships no standalone binary for ${process.arch}` }
    mkdirSync(deps.dir, { recursive: true })
    const state = readState()
    // The latest's version is in GitHub's first redirect, to the tag's own checksums; the next one goes to an asset host that names none.
    let version: string | null
    try {
      const latest = await deps.fetch(LATEST_SUMS, { redirect: 'manual', signal: AbortSignal.timeout(DOWNLOAD_MS) })
      version = releaseTag(latest.headers.get('location') ?? '')
      if (version === null) throw new Error(`the latest release names no version (${latest.status} from ${LATEST_SUMS})`)
    } catch (error) {
      reportFault('music.player.ytdlp', error)
      return { kind: 'unavailable', why: error instanceof Error ? error.message : String(error) }
    }
    const recheck = async (outcome: UpdateOutcome): Promise<UpdateOutcome> => (reason === 'failure' ? ((await recheckCurrent(readState())) ?? outcome) : outcome)
    if (state.current === version && existsSync(current)) return recheck({ kind: 'current', version })
    if (state.rejected?.version === version && now() - state.rejected.at < REJECTED_FOR_MS) return recheck({ kind: 'rejected', version, why: 'it failed the self-check within the day' })
    let sums: string
    try {
      sums = await (await fetchOk(`${RELEASES}/download/${version}/SHA2-256SUMS`)).text()
    } catch (error) {
      reportFault('music.player.ytdlp', error)
      return { kind: 'unavailable', why: error instanceof Error ? error.message : String(error) }
    }

    const reject = (why: string): Promise<UpdateOutcome> => {
      rmSync(candidate, { force: true })
      writeState({ ...readState(), rejected: { version, at: now() } })
      reportFault('music.player.ytdlp', new Error(`yt-dlp ${version} is not used: ${why}`))
      return recheck({ kind: 'rejected', version, why })
    }
    const expected = checksumOf(sums, asset)
    if (expected === null) return reject(`its SHA2-256SUMS names no ${asset}`)
    let bytes: Buffer
    try {
      bytes = Buffer.from(await (await fetchOk(`${RELEASES}/download/${version}/${asset}`)).arrayBuffer())
    } catch (error) {
      reportFault('music.player.ytdlp', error)
      return { kind: 'unavailable', why: error instanceof Error ? error.message : String(error) }
    }
    if (createHash('sha256').update(bytes).digest('hex') !== expected) return reject(`${asset} does not match its SHA2-256SUMS`)
    writeFileSync(candidate, bytes)
    chmodSync(candidate, 0o755)
    const failed = await selfCheck(candidate)
    if (failed !== null) return reject(`it failed the self-check (${failed})`)
    // Passed: the copy in use becomes the previous one, kept for a rollback.
    if (state.current !== undefined && existsSync(current)) renameSync(current, previous)
    renameSync(candidate, current)
    writeState({ current: version, ...(state.current !== undefined ? { previous: state.current } : {}) })
    return { kind: 'updated', version }
  }

  return {
    binary() {
      return readState().current !== undefined && existsSync(current) ? current : null
    },
    update(reason) {
      running ??= run(reason).finally(() => {
        running = null
      })
      return running
    },
  }
}
