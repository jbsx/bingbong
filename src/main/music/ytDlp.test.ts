import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { askDefaultClients, parseLookup, resolveAudioStream } from './ytDlp'

describe("the audio road's lookup (#502)", () => {
  it('reads the stream and when YouTube serves it', () => {
    expect(parseLookup('1793237545 https://rr1.googlevideo.com/videoplayback?id=1\n')).toEqual({ stream: 'https://rr1.googlevideo.com/videoplayback?id=1', availableAt: 1793237545000 })
  })

  it('a stream yt-dlp names no time for is served at once', () => {
    expect(parseLookup('NA https://rr1.googlevideo.com/videoplayback?id=1')).toEqual({ stream: 'https://rr1.googlevideo.com/videoplayback?id=1', availableAt: null })
  })

  it("a bare address, `-g`'s shape, names no time", () => {
    expect(parseLookup('https://stream.example/aaaaaaaaaaa\n')).toEqual({ stream: 'https://stream.example/aaaaaaaaaaa', availableAt: null })
  })

  it('no address is no stream', () => {
    expect(parseLookup('')).toBeNull()
    expect(parseLookup('1793237545 NA')).toBeNull()
  })

  it("the stream is found under yt-dlp's own step lines (#516)", () => {
    const printed = '[youtube] Extracting URL: https://www.youtube.com/watch?v=aqz-KE-bpKQ\n[info] aqz-KE-bpKQ: Downloading 1 format(s): 251\n1793237545 https://rr1.googlevideo.com/videoplayback?id=1\n'
    expect(parseLookup(printed)).toEqual({ stream: 'https://rr1.googlevideo.com/videoplayback?id=1', availableAt: 1793237545000 })
    expect(parseLookup('Some line of its own\nNA https://stream.example/a\n')).toEqual({ stream: 'https://stream.example/a', availableAt: null })
  })
})

describe('visionos first, then the default clients, within one bound (#516)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bingbong-ytdlp-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  let made = 0
  const ANSWER = 'echo "[youtube] Extracting URL: https://www.youtube.com/watch?v=aqz-KE-bpKQ"; echo "[youtube] aqz-KE-bpKQ: Downloading webpage"; echo "NA https://stream.example/secret?sig=1"'
  /** A yt-dlp on disk: `visionos` is what it does when asked for that client, `other` when not. Each ask's arguments land in its log. */
  function fake(visionos: string, other: string): { binary: string; asks(): string[] } {
    const base = join(dir, `yt-dlp-${(made += 1)}`)
    writeFileSync(base, `#!/bin/sh\necho "$*" >> ${base}.log\ncase "$*" in\n  *player_client=visionos*) ${visionos} ;;\n  *) ${other} ;;\nesac\n`)
    chmodSync(base, 0o755)
    return { binary: base, asks: () => readFileSync(`${base}.log`, 'utf8').trim().split('\n') }
  }
  const REFUSED = 'echo "ERROR: [youtube] aqz-KE-bpKQ: refused" >&2; exit 1'

  it('visionos answers: one ask, skipping the manifests, and the record names it', async () => {
    const yt = fake(ANSWER, 'exit 9')
    const found = await resolveAudioStream(yt.binary, 'aqz-KE-bpKQ')
    expect(found).toMatchObject({ stream: 'https://stream.example/secret?sig=1', availableAt: null, asked: { client: 'visionos', failedFirst: null } })
    expect(yt.asks()).toHaveLength(1)
    expect(yt.asks()[0]).toContain('youtube:skip=hls,dash;player_client=visionos')
  })

  it('visionos failing still answers, by the default clients, and the record says why the first failed', async () => {
    const yt = fake(REFUSED, ANSWER)
    const found = await resolveAudioStream(yt.binary, 'aqz-KE-bpKQ')
    expect(found.stream).toBe('https://stream.example/secret?sig=1')
    expect(found.asked).toMatchObject({ client: 'default', failedFirst: { why: 'ERROR: [youtube] aqz-KE-bpKQ: refused' } })
    expect(yt.asks()).toHaveLength(2)
    expect(yt.asks()[1]).not.toContain('player_client')
  })

  it('visionos printing no address is a failure too', async () => {
    const yt = fake('echo "[youtube] nothing"', ANSWER)
    expect((await resolveAudioStream(yt.binary, 'aqz-KE-bpKQ')).asked).toMatchObject({ client: 'default', failedFirst: { why: 'printed no address' } })
  })

  it('visionos running past its bound is cut off, and the default clients answer', async () => {
    const yt = fake('exec sleep 5', ANSWER)
    const found = await resolveAudioStream(yt.binary, 'aqz-KE-bpKQ', 4_000, 100)
    expect(found.asked).toMatchObject({ client: 'default', failedFirst: { why: 'ran out of time' } })
  })

  it('the default clients get only what the bound has left', async () => {
    const yt = fake('exec sleep 5', 'exec sleep 5')
    const from = Date.now()
    await expect(resolveAudioStream(yt.binary, 'aqz-KE-bpKQ', 400, 200)).rejects.toThrow(/ran out of time/)
    expect(Date.now() - from).toBeLessThan(2_000)
  })

  it('both failing rejects, naming both', async () => {
    const yt = fake(REFUSED, 'echo "ERROR: gone" >&2; exit 1')
    await expect(resolveAudioStream(yt.binary, 'aqz-KE-bpKQ')).rejects.toThrow(/refused.*gone/)
  })

  it("the record times yt-dlp's steps as they came, without the video's id or the stream's address", async () => {
    const yt = fake(ANSWER, 'exit 9')
    const { asked } = await resolveAudioStream(yt.binary, 'aqz-KE-bpKQ')
    expect(asked?.steps.map((each) => each.step)).toEqual(['[youtube] Extracting URL', '[youtube] Downloading webpage', 'printed', 'exit'])
    const times = asked!.steps.map((each) => each.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it("the self-check's ask never takes visionos: it proves the binary, and its failure is not hidden by a fallback", async () => {
    const works = fake(ANSWER, ANSWER)
    expect(await askDefaultClients(works.binary, 'aqz-KE-bpKQ', 2_000)).toMatchObject({ stream: 'https://stream.example/secret?sig=1', asked: { client: 'default', failedFirst: null } })
    expect(works.asks()).toHaveLength(1)
    expect(works.asks()[0]).not.toContain('player_client')
    const broken = fake(ANSWER, REFUSED)
    await expect(askDefaultClients(broken.binary, 'aqz-KE-bpKQ', 2_000)).rejects.toThrow(/refused/)
  })
})
