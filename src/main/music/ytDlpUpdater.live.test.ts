import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { resolveAudioStream, ytDlpVersion } from './ytDlp'
import { createYtDlpUpdater, SELF_CHECK_VIDEO, type UpdaterFetch } from './ytDlpUpdater'

// The live run (#503's measure): a real release from GitHub, the real
// self-check against YouTube, and each rollback forced by a corrupt copy.
// Opt-in: BINGBONG_YTDLP_LIVE=1. Its copies go under $XDG_RUNTIME_DIR, never
// the app's userData. Nothing is played: the self-check counts bytes.

const live = process.env.BINGBONG_YTDLP_LIVE === '1'
const dir = join(process.env.XDG_RUNTIME_DIR ?? '/tmp', 'bingbong-503-live')
/** Zips built here from the good copy, apart from the updater's dir. */
const work = `${dir}.work`
const ms = (from: number): number => Math.round(performance.now() - from)
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const ZIP = 'yt-dlp_linux.zip'

describe.skipIf(!live)("the app's own yt-dlp, live (#503)", () => {
  it('downloads, unpacks, self-checks, and rolls back from a corrupt copy', { timeout: 15 * 60_000 }, async () => {
    for (const path of [dir, work]) rmSync(path, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    mkdirSync(work, { recursive: true })
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    // The release's zip swapped on the way in for `bad`, with the checksums rewritten to match when `matching`.
    const corrupt: { bad: Buffer | null; matching: boolean } = { bad: null, matching: false }
    const fetchThrough: UpdaterFetch = async (url, init) => {
      const response = await fetch(url, init)
      const bad = corrupt.bad
      if (bad === null || !url.startsWith('https://github.com/') || init?.redirect === 'manual') return response
      const body = Buffer.from(await response.arrayBuffer())
      const bytes = url.endsWith(`/${ZIP}`) ? bad : url.endsWith('/SHA2-256SUMS') && corrupt.matching ? Buffer.from(body.toString().replace(/^[0-9a-f]{64}(?=\s+yt-dlp_linux\.zip$)/m, sha(bad))) : body
      return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, text: async () => bytes.toString(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
    }
    // A fresh updater after each state written by hand: it reads its state once.
    const fresh = () => createYtDlpUpdater({ dir, on: () => true, fetch: fetchThrough, lookup: resolveAudioStream })
    const log: string[] = []
    const state = (): { current?: string; previous?: string } => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as { current?: string; previous?: string }
    const exe = (version: string): string => join(dir, version, 'yt-dlp_linux')

    // 0. PATH's yt-dlp, when it is the latest release and passes the self-check, is kept: nothing is downloaded.
    const from0 = performance.now()
    const kept = await createYtDlpUpdater({ dir, on: () => true, fetch: fetchThrough, lookup: resolveAudioStream, path: { binary: 'yt-dlp', version: () => ytDlpVersion('yt-dlp') } }).update('boot')
    log.push(`0 PATH's yt-dlp: ${JSON.stringify(kept)} in ${ms(from0)} ms`)
    expect(kept.kind).toBe('path')
    rmSync(dir, { recursive: true, force: true })

    // 1. A real download, unpack and self-check.
    let updater = fresh()
    let from = performance.now()
    const first = await updater.update('boot')
    log.push(`1 download+unpack+self-check: ${JSON.stringify(first)} in ${ms(from)} ms`)
    expect(first.kind).toBe('updated')
    const version = state().current!
    expect(updater.binary()).toBe(exe(version))

    // 2. Start-up (`--version`) and the lookup's time on each, 3 runs each (no fetch of the stream, nothing played).
    for (const [name, binary] of [['PATH', 'yt-dlp'], ['app', exe(version)]] as const) {
      const starts: number[] = []
      const lookups: number[] = []
      for (let run = 0; run < 3; run++) {
        from = performance.now()
        execFileSync(binary, ['--version'])
        starts.push(ms(from))
        from = performance.now()
        await resolveAudioStream(binary, SELF_CHECK_VIDEO, 30_000)
        lookups.push(ms(from))
      }
      log.push(`2 ${name}: --version ${starts.join(', ')} ms; lookup ${lookups.join(', ')} ms`)
    }

    // The copy in use made to look stale, so each run below downloads the latest again.
    const stale = (): void => {
      renameSync(join(dir, state().current!), join(dir, '2000.01.01'))
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: '2000.01.01' }))
      updater = fresh()
    }

    // 3. A corrupt zip (truncated to its first MB) with the release's own checksums: never unpacked or run, the copy in use stays.
    const zip = join(work, 'good.zip')
    execFileSync('zip', ['-qr', zip, '.'], { cwd: join(dir, version) })
    stale()
    corrupt.bad = readFileSync(zip).subarray(0, 1024 * 1024)
    from = performance.now()
    const bySum = await updater.update('daily')
    log.push(`3 corrupt zip, real sums: ${JSON.stringify(bySum)} in ${ms(from)} ms`)
    expect(bySum).toMatchObject({ kind: 'rejected', why: `${ZIP} does not match its SHA2-256SUMS` })
    expect(updater.binary()).toBe(exe('2000.01.01'))

    // 4a. The same truncated zip with checksums that match: it cannot be unpacked, so it is never run.
    corrupt.matching = true
    from = performance.now()
    const byUnpack = await updater.update('daily')
    log.push(`4a truncated zip, matching sums: ${JSON.stringify(byUnpack)} in ${ms(from)} ms`)
    expect(byUnpack).toMatchObject({ kind: 'rejected', why: expect.stringMatching(/^it could not be unpacked/) })
    expect(updater.binary()).toBe(exe('2000.01.01'))

    // 4b. A zip that unpacks but whose copy is broken (the executable without its _internal/), checksums matching: run, fails the self-check, never switched to.
    const broken = join(work, 'broken')
    mkdirSync(broken)
    cpSync(exe('2000.01.01'), join(broken, 'yt-dlp_linux'))
    execFileSync('zip', ['-q', join(work, 'broken.zip'), 'yt-dlp_linux'], { cwd: broken })
    corrupt.bad = readFileSync(join(work, 'broken.zip'))
    updater = fresh()
    from = performance.now()
    const byCheck = await updater.update('daily')
    log.push(`4b broken copy, matching sums: ${JSON.stringify(byCheck)} in ${ms(from)} ms`)
    expect(byCheck).toMatchObject({ kind: 'rejected', why: expect.stringMatching(/^it failed the self-check/) })
    expect(updater.binary()).toBe(exe('2000.01.01'))
    expect(existsSync(join(dir, `${version}.candidate`))).toBe(false)
    corrupt.bad = null
    corrupt.matching = false

    // 5. The copy in use made corrupt (its _internal/ gone), a good previous kept: a resolve failure switches back to it, by directory.
    renameSync(join(dir, '2000.01.01'), join(dir, version))
    cpSync(join(dir, version), join(dir, `${version}-kept`), { recursive: true })
    rmSync(join(dir, version, '_internal'), { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: version, previous: `${version}-kept` }))
    updater = fresh()
    from = performance.now()
    const back = await updater.update('failure')
    log.push(`5 corrupt copy in use: ${JSON.stringify(back)} in ${ms(from)} ms`)
    expect(back).toEqual({ kind: 'rolled-back', from: version, to: `${version}-kept` })
    expect(updater.binary()).toBe(exe(`${version}-kept`))
    expect(existsSync(join(dir, version))).toBe(false)
    expect(faults.map((fault) => fault.message)).toContainEqual(expect.stringMatching(new RegExp(`^yt-dlp ${version} failed the self-check .*switched back to yt-dlp ${version}-kept$`, 's')))

    for (const fault of faults) log.push(`fault ${fault.site}: ${fault.message.slice(0, 220)}`)
    setFaultSink(null)
    for (const path of [dir, work]) rmSync(path, { recursive: true, force: true })
    process.stdout.write(`\n#503 live run, ${version}\n${log.join('\n')}\n`)
  })
})
