import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setFaultSink, type FaultReport } from '../../core/trace/fault'
import { resolveAudioStream } from './ytDlp'
import { createYtDlpUpdater, SELF_CHECK_VIDEO, type UpdaterFetch } from './ytDlpUpdater'

// The live run (#503's measure): a real release from GitHub, the real
// self-check against YouTube, and each rollback forced by a corrupt binary.
// Opt-in: BINGBONG_YTDLP_LIVE=1. Its copies go under $XDG_RUNTIME_DIR, never
// the app's userData. Nothing is played: the self-check counts bytes.

const live = process.env.BINGBONG_YTDLP_LIVE === '1'
const dir = join(process.env.XDG_RUNTIME_DIR ?? '/tmp', 'bingbong-503-live')
const ms = (from: number): number => Math.round(performance.now() - from)

describe.skipIf(!live)("the app's own yt-dlp, live (#503)", () => {
  it('downloads, self-checks, and rolls back from a corrupt binary', { timeout: 15 * 60_000 }, async () => {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const faults: FaultReport[] = []
    setFaultSink((report) => faults.push(report))
    // A download made corrupt (truncated to its first MB) on the way in, with the checksums rewritten to match when `matching`.
    const corrupt = { on: false, matching: false }
    const fetchThrough: UpdaterFetch = async (url, init) => {
      const response = await fetch(url, init)
      if (!corrupt.on || !url.startsWith('https://github.com/')) return response
      const body = Buffer.from(await response.arrayBuffer())
      const bad = url.endsWith('/yt-dlp_linux') ? body.subarray(0, 1024 * 1024) : body
      const text = url.endsWith('/SHA2-256SUMS') && corrupt.matching ? body.toString().replace(/^[0-9a-f]{64}(?=\s+yt-dlp_linux$)/m, corruptSha) : bad.toString('latin1')
      const bytes = url.endsWith('/SHA2-256SUMS') ? Buffer.from(text) : bad
      return { ok: response.ok, status: response.status, url: response.url, headers: response.headers, text: async () => bytes.toString(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }
    }
    let corruptSha = ''
    // A fresh updater after each state written by hand: it reads its state once.
    const fresh = () => createYtDlpUpdater({ dir, on: () => true, fetch: fetchThrough, lookup: resolveAudioStream })
    let updater = fresh()
    const log: string[] = []
    const state = (): { current?: string; previous?: string } => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as { current?: string; previous?: string }

    // 1. A real download and self-check.
    let from = performance.now()
    const first = await updater.update('boot')
    log.push(`1 download+self-check: ${JSON.stringify(first)} in ${ms(from)} ms`)
    expect(first.kind).toBe('updated')
    const version = state().current!
    const good = readFileSync(join(dir, 'yt-dlp'))

    // 2. The lookup's time on each binary, 3 runs each (no fetch of the stream, nothing played).
    for (const [name, binary] of [['PATH', 'yt-dlp'], ['app', join(dir, 'yt-dlp')]] as const) {
      const times: number[] = []
      for (let run = 0; run < 3; run++) {
        from = performance.now()
        await resolveAudioStream(binary, SELF_CHECK_VIDEO, 30_000)
        times.push(ms(from))
      }
      log.push(`2 lookup on ${name}: ${times.join(', ')} ms`)
    }

    // 3. A corrupt download with the release's own checksums: never run, the copy in use stays.
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: '2000.01.01' }))
    updater = fresh()
    corrupt.on = true
    from = performance.now()
    const bySum = await updater.update('daily')
    log.push(`3 corrupt, real sums: ${JSON.stringify(bySum)} in ${ms(from)} ms`)
    expect(bySum).toMatchObject({ kind: 'rejected', why: 'yt-dlp_linux does not match its SHA2-256SUMS' })
    expect(updater.binary()).toBe(join(dir, 'yt-dlp'))

    // 4. A corrupt candidate whose checksum matches: run, fails the self-check, never switched to.
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: '2000.01.01' }))
    updater = fresh()
    corruptSha = createHash('sha256').update(good.subarray(0, 1024 * 1024)).digest('hex')
    corrupt.matching = true
    from = performance.now()
    const byCheck = await updater.update('daily')
    log.push(`4 corrupt, matching sums: ${JSON.stringify(byCheck)} in ${ms(from)} ms`)
    expect(byCheck.kind).toBe('rejected')
    expect(readFileSync(join(dir, 'yt-dlp')).equals(good)).toBe(true)
    corrupt.on = false

    // 5. The copy in use made corrupt, a good previous kept: a resolve failure switches back to it.
    copyFileSync(join(dir, 'yt-dlp'), join(dir, 'yt-dlp.previous'))
    writeFileSync(join(dir, 'yt-dlp'), good.subarray(0, 1024 * 1024))
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ current: version, previous: `${version}-kept` }))
    updater = fresh()
    from = performance.now()
    const back = await updater.update('failure')
    log.push(`5 corrupt copy in use: ${JSON.stringify(back)} in ${ms(from)} ms`)
    expect(back).toEqual({ kind: 'rolled-back', from: version, to: `${version}-kept` })
    expect(readFileSync(join(dir, 'yt-dlp')).equals(good)).toBe(true)
    expect(faults.map((fault) => fault.message)).toContainEqual(expect.stringMatching(new RegExp(`^yt-dlp ${version} failed the self-check .*switched back to yt-dlp ${version}-kept$`, 's')))

    for (const fault of faults) log.push(`fault ${fault.site}: ${fault.message.slice(0, 220)}`)
    setFaultSink(null)
    process.stdout.write(`\n#503 live run, ${version}\n${log.join('\n')}\n`)
  })
})
