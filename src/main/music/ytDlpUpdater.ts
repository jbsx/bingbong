import { execFile, type ExecFileException } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { reportFault } from '../../core/trace/fault'
import type { AudioStream } from './ytDlp'

// The app's own yt-dlp (#503): YouTube changes its scheme often and a stale
// yt-dlp fails quietly — on 2026-10-28 a 2026.07.04 build's streams were
// refused (403) past their first 512 KB, a song that starts and then stops.
// So the app keeps a copy of yt-dlp's own release build in userData,
// where it can replace it without sudo (ruling 1 on #503): the release's
// SHA2-256SUMS is checked before it is ever run, and a copy is used only
// once it has passed the self-check; until then the yt-dlp on PATH is. The
// copy is the release's onedir zip (`yt-dlp_linux.zip`), unpacked into a
// directory per version: it starts in 617 ms on the kiosk against the
// onefile binary's 1185 ms, and its lookups are the fastest measured
// (median 4480 ms vs 5180 ms; the kiosk measure on #503, 2026-10-29). The
// previous directory is kept, and a copy that fails the self-check is never
// switched to, or is switched back from (ruling 4). PATH's yt-dlp is still
// preferred while it is the latest release and passes the self-check: it
// starts fastest (pipx 182 ms vs the onedir release's 313 ms on dev,
// 2026-10-29), so the app's copy is the net for a PATH gone stale, and is
// downloaded only then (ruling of 11:35). Everything here runs
// in the background, behind the road's own switch: never on a Command's path.

/** Where releases come from: the public yt-dlp/yt-dlp GitHub releases, nowhere else. */
const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases'
/** The latest release's checksums: GitHub redirects to the tag's own, which names the version. */
const LATEST_SUMS = `${RELEASES}/latest/download/SHA2-256SUMS`

/** The release's onedir zip for this machine's architecture; null where yt-dlp ships none, and PATH's is used. */
export function releaseAsset(arch: string = process.arch): string | null {
  return arch === 'x64' ? 'yt-dlp_linux.zip' : arch === 'arm64' ? 'yt-dlp_linux_aarch64.zip' : null
}

/** The executable at the zip's root, beside its `_internal/`: the zip's name without `.zip`. */
export const executableOf = (asset: string): string => asset.replace(/\.zip$/, '')

/** A release's version as yt-dlp tags it; anything else is not a release, and never names a directory. */
const VERSION = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/
/** The longest an unpack may take: about 100 MB onto the kiosk's disk. */
const UNPACK_MS = 120_000

/**
 * Unpacks a zip into an empty directory with the system's `unzip`, else
 * `bsdtar` (the kiosk has both, dev only `unzip`). The zip's checksum is
 * checked before; any exit but 0 is a refusal, warnings too (unzip's 1 for
 * a member it stripped of `../`), so a zip unpacked other than whole is
 * never run.
 */
export async function extractZip(zip: string, into: string): Promise<void> {
  const tools: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['unzip', ['-q', '-o', zip, '-d', into]],
    ['bsdtar', ['-xf', zip, '-C', into]],
  ]
  let missing: unknown = null
  for (const [tool, args] of tools) {
    const [error, stderr] = await new Promise<[ExecFileException | null, string]>((resolve) => execFile(tool, args, { timeout: UNPACK_MS }, (failed, _out, err) => resolve([failed, String(err)])))
    if (error === null) return
    // The tool's own first line on it, not the whole of its output; unzip opens with `[zipfile]`, which says nothing.
    const why = stderr.split('\n').map((line) => line.trim()).find((line) => line !== '' && !line.startsWith('[')) ?? error.message
    if (error.code !== 'ENOENT') throw new Error(`${tool} could not unpack ${zip}: ${why}`)
    missing = error
  }
  throw new Error(`neither unzip nor bsdtar is installed (${missing instanceof Error ? missing.message : String(missing)})`)
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
  /** The lookup that proves a binary, run on it: `askDefaultClients`, with no fallback in it to hide one that fails (#516). */
  lookup(binary: string, id: string, timeoutMs: number): Promise<AudioStream>
  /**
   * The yt-dlp on PATH and how to read its version. It is kept while it is
   * the latest release and passes the self-check, since it starts fastest
   * (the orchestrator's ruling of 11:35 on #503); otherwise the app's copy
   * is used. Absent, only the app's copy is considered.
   */
  readonly path?: { readonly binary: string; version(): Promise<string> }
  /** The release's zip; `releaseAsset()` by default. */
  readonly asset?: string | null
  /** Unpacks the checked zip into an empty directory; `extractZip` by default. */
  extract?(zip: string, into: string): Promise<void>
  now?(): number
  sleep?(ms: number): Promise<void>
}

export type UpdateReason = 'boot' | 'daily' | 'failure'

export type UpdateOutcome =
  | { readonly kind: 'off' }
  /** PATH's yt-dlp is the latest release and passed the self-check: it is used, and nothing is downloaded. */
  | { readonly kind: 'path'; readonly version: string }
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

/** What the dir holds besides the copies' directories, each named by its version: which is in use, which is kept, and the last release rejected. */
interface UpdaterState {
  /** The last run found PATH's yt-dlp current and passing: songs take it over the app's copy. */
  onPath?: boolean
  current?: string
  previous?: string
  rejected?: { version: string; at: number }
}

/** The version a release URL names: `…/releases/download/<tag>/…`. */
export function releaseTag(url: string): string | null {
  return /\/releases\/download\/([^/]+)\//.exec(url)?.[1] ?? null
}

/** Whether a yt-dlp version (`2026.10.26`, `2026.10.26.1`) is older than another; an unreadable one is older than any. */
export function olderRelease(version: string, than: string): boolean {
  const parts = (v: string): number[] | null => (VERSION.test(v.trim()) ? v.trim().split('.').map(Number) : null)
  const [a, b] = [parts(version), parts(than)]
  if (a === null) return true
  if (b === null) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  return false
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

/** The slice of the audio surface's `webRequest` the watch hears: a fake in the tests. */
export interface StreamRequests {
  onCompleted(filter: { urls: string[] }, listener: (details: { statusCode: number }) => void): void
  onErrorOccurred(filter: { urls: string[] }, listener: (details: { error: string }) => void): void
}

/**
 * A stream refused (403), as a stale yt-dlp's were past their first 512 KB
 * (2026-10-28), is a resolve failure (#503): the song itself goes on as it
 * does today, and the updater runs at most hourly. A stream cut off by the
 * network counts too; one the element itself let go (a stop, a seek, the
 * next song) does not. Nor does either on a remembered address (#516): it
 * can be refused after the IP changes, with no yt-dlp at fault. `refused`
 * tells the Player, which forgets the address and says whether it was one.
 */
export function watchStreamFaults(requests: StreamRequests, refused: (status?: number) => boolean, failed: () => void): void {
  const urls = ['*://*.googlevideo.com/*']
  requests.onCompleted({ urls }, (details) => {
    if (details.statusCode === 403 && !refused(details.statusCode)) failed()
  })
  requests.onErrorOccurred({ urls }, (details) => {
    if (details.error !== 'net::ERR_ABORTED' && !refused()) failed()
  })
}

export function createYtDlpUpdater(deps: YtDlpUpdaterDeps): YtDlpUpdater {
  const asset = deps.asset === undefined ? releaseAsset() : deps.asset
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const extract = deps.extract ?? extractZip
  const stateFile = join(deps.dir, 'state.json')
  /** A copy's directory, and the executable in it. */
  const home = (version: string): string => join(deps.dir, version)
  const executable = (version: string): string => join(home(version), executableOf(asset ?? ''))
  const has = (version: string | undefined): version is string => version !== undefined && existsSync(executable(version))
  let running: Promise<UpdateOutcome> | null = null
  let queuedFailure: Promise<UpdateOutcome> | null = null

  /** No state yet is no copy; a state that cannot be read is no copy either, and PATH's is used until the next run writes one. */
  function loadState(): UpdaterState {
    if (!existsSync(stateFile)) return {}
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8')) as UpdaterState
    } catch (error) {
      reportFault('music.player.ytdlp', error)
      return {}
    }
  }
  // Read once and held: each song asks for the binary, and no song reads a file for it.
  // A copy named whose directory is gone (or the first layout's single file) is no copy.
  let held = loadState()
  if (!has(held.current)) held = { ...held, current: undefined }
  if (!has(held.previous)) held = { ...held, previous: undefined }
  const readState = (): UpdaterState => held
  /** Written whole or not at all: a crash mid-write leaves the last state, not a torn one. */
  function writeState(state: UpdaterState): void {
    writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state)}\n`)
    renameSync(`${stateFile}.tmp`, stateFile)
    held = state
  }
  /** Everything but the state and the two copies it names goes: a candidate a crash left, a copy rolled back from, the first layout's files. */
  function prune(): void {
    const keep = new Set(['state.json', held.current, held.previous])
    for (const entry of readdirSync(deps.dir)) if (!keep.has(entry)) rmSync(join(deps.dir, entry), { recursive: true, force: true })
  }
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  /** A release that could not be read or fetched: the copy in use stays, and the fault log says why. */
  function unavailable(error: unknown): UpdateOutcome {
    reportFault('music.player.ytdlp', error)
    return { kind: 'unavailable', why: message(error) }
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
      return `the lookup failed: ${message(error)}`
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
      return `the stream's range could not be fetched: ${message(error)}`
    }
  }

  async function fetchOk(url: string): Promise<Awaited<ReturnType<UpdaterFetch>>> {
    const response = await deps.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return response
  }

  /** The copy in use, checked again on a resolve failure: failing (or gone), the previous copy if it passes, else PATH's. */
  async function recheckCurrent(state: UpdaterState): Promise<UpdateOutcome | null> {
    if (state.current === undefined) return null
    const why = await selfCheck(executable(state.current))
    if (why === null) return null
    const from = state.current
    // Switched back by directory: the previous one becomes the one in use, and the failing one goes.
    const to = has(state.previous) && (await selfCheck(executable(state.previous))) === null ? state.previous : null
    writeState({ ...(to === null ? {} : { current: to }), rejected: { version: from, at: now() } })
    prune()
    reportFault('music.player.ytdlp', new Error(`yt-dlp ${from} failed the self-check (${why}): switched back to ${to === null ? "the yt-dlp on PATH" : `yt-dlp ${to}`}`))
    return { kind: 'rolled-back', from, to }
  }

  async function run(reason: UpdateReason): Promise<UpdateOutcome> {
    if (!deps.on()) return { kind: 'off' }
    if (asset === null) return { kind: 'unavailable', why: `yt-dlp ships no release build for ${process.arch}` }
    mkdirSync(deps.dir, { recursive: true })
    // What a crash or the first layout left goes on every run, whichever copy wins it.
    prune()
    // The latest's version is in GitHub's first redirect, to the tag's own checksums; the next one goes to an asset host that names none.
    let version: string | null
    try {
      const latest = await deps.fetch(LATEST_SUMS, { redirect: 'manual', signal: AbortSignal.timeout(DOWNLOAD_MS) })
      version = releaseTag(latest.headers.get('location') ?? '')
      if (version === null || !VERSION.test(version)) throw new Error(`the latest release names no version (${latest.status} from ${LATEST_SUMS})`)
    } catch (error) {
      return unavailable(error)
    }
    // PATH's yt-dlp first: the latest release and passing, it is kept and nothing is downloaded. Older, it is not run at all.
    if (deps.path !== undefined) {
      const onPath = await deps.path.version().then((found) => (olderRelease(found, version) ? null : found), () => null)
      if (onPath !== null && (await selfCheck(deps.path.binary)) === null) {
        if (held.onPath !== true) writeState({ ...held, onPath: true })
        return { kind: 'path', version: onPath }
      }
      if (held.onPath === true) writeState({ ...held, onPath: false })
    }
    const recheck = async (outcome: UpdateOutcome): Promise<UpdateOutcome> => (reason === 'failure' ? ((await recheckCurrent(readState())) ?? outcome) : outcome)
    const state = readState()
    if (state.current === version && has(version)) return recheck({ kind: 'current', version })
    if (state.rejected?.version === version && now() - state.rejected.at < REJECTED_FOR_MS) return recheck({ kind: 'rejected', version, why: 'it failed the self-check within the day' })
    let sums: string
    try {
      sums = await (await fetchOk(`${RELEASES}/download/${version}/SHA2-256SUMS`)).text()
    } catch (error) {
      return unavailable(error)
    }

    const zip = join(deps.dir, `${version}.zip.part`)
    const candidate = join(deps.dir, `${version}.candidate`)
    /** Not switched to. A release that failed the self-check is not tried again within the day; a bad download is tried by the next run. */
    const reject = (why: string, remembered = true): Promise<UpdateOutcome> => {
      rmSync(zip, { force: true })
      rmSync(candidate, { recursive: true, force: true })
      if (remembered) writeState({ ...readState(), rejected: { version, at: now() } })
      reportFault('music.player.ytdlp', new Error(`yt-dlp ${version} is not used: ${why}`))
      return recheck({ kind: 'rejected', version, why })
    }
    const expected = checksumOf(sums, asset)
    if (expected === null) return reject(`its SHA2-256SUMS names no ${asset}`)
    let bytes: Buffer
    try {
      bytes = Buffer.from(await (await fetchOk(`${RELEASES}/download/${version}/${asset}`)).arrayBuffer())
    } catch (error) {
      return unavailable(error)
    }
    if (createHash('sha256').update(bytes).digest('hex') !== expected) return reject(`${asset} does not match its SHA2-256SUMS`, false)
    rmSync(candidate, { recursive: true, force: true })
    mkdirSync(candidate)
    writeFileSync(zip, bytes)
    try {
      await extract(zip, candidate)
      chmodSync(join(candidate, executableOf(asset)), 0o755)
    } catch (error) {
      return reject(`it could not be unpacked (${message(error)})`, false)
    } finally {
      rmSync(zip, { force: true })
    }
    const why = await selfCheck(join(candidate, executableOf(asset)))
    if (why !== null) return reject(`it failed the self-check (${why})`)
    // Passed: the copy in use becomes the previous one, kept for a rollback; the one before it goes.
    rmSync(home(version), { recursive: true, force: true })
    renameSync(candidate, home(version))
    writeState({ current: version, ...(has(state.current) && state.current !== version ? { previous: state.current } : {}) })
    prune()
    return { kind: 'updated', version }
  }

  const updater: YtDlpUpdater = {
    binary() {
      return held.onPath !== true && held.current !== undefined ? executable(held.current) : null
    },
    update(reason) {
      if (running === null) {
        running = run(reason).finally(() => {
          running = null
        })
        return running
      }
      // A resolve failure while another run is under way is not lost: the copy in use is checked once that run ends.
      if (reason !== 'failure') return running
      queuedFailure ??= running.then(() => {
        queuedFailure = null
        return updater.update('failure')
      })
      return queuedFailure
    },
  }
  return updater
}
