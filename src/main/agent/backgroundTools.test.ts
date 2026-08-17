import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackgroundTools } from './backgroundTools'

const CTX = { clock: { now: () => 0, setTimer: () => () => {} } }
const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bingbong-background-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('background tools', () => {
  it('downloads a direct URL into the confined directory with a unique name', async () => {
    const dir = await tempDir()
    const tools = createBackgroundTools({
      downloadsDir: dir,
      fetchFn: (async () => new Response('payload', { status: 200 })) as typeof fetch,
    })
    const download = tools.find((tool) => tool.name === 'download_url')!

    await download.execute(
      { id: 'd1', name: 'download_url', args: { url: 'https://files.test/report.txt' } },
      CTX,
    )
    await download.execute(
      { id: 'd2', name: 'download_url', args: { url: 'https://files.test/report.txt' } },
      CTX,
    )

    expect(await readFile(join(dir, 'report.txt'), 'utf8')).toBe('payload')
    expect(await readFile(join(dir, 'report (1).txt'), 'utf8')).toBe('payload')
  })

  it('never deletes another download when same-name creates race', async () => {
    const dir = await tempDir()
    const tools = createBackgroundTools({
      downloadsDir: dir,
      fetchFn: (async () => new Response('payload', { status: 200 })) as typeof fetch,
    })
    const download = tools.find((tool) => tool.name === 'download_url')!
    const call = (id: string) =>
      download.execute(
        { id, name: 'download_url', args: { url: 'https://files.test/race.txt' } },
        CTX,
      )

    await Promise.allSettled(Array.from({ length: 8 }, (_, index) => call(`d${index}`)))

    expect(await readFile(join(dir, 'race.txt'), 'utf8')).toBe('payload')
  })

  it('rejects non-HTTP downloads', async () => {
    const dir = await tempDir()
    const download = createBackgroundTools({ downloadsDir: dir, fetchFn: fetch }).find(
      (tool) => tool.name === 'download_url',
    )!

    await expect(
      download.execute({ id: 'd1', name: 'download_url', args: { url: 'file:///etc/passwd' } }, CTX),
    ).rejects.toThrow(/only HTTP/)
  })

  it('streams with a hard size limit and removes partial files on overflow', async () => {
    const dir = await tempDir()
    const download = createBackgroundTools({
      downloadsDir: dir,
      fetchFn: (async () => new Response('payload')) as typeof fetch,
      maxDownloadBytes: 3,
    }).find((tool) => tool.name === 'download_url')!

    await expect(
      download.execute(
        { id: 'd1', name: 'download_url', args: { url: 'https://files.test/large.txt' } },
        CTX,
      ),
    ).rejects.toThrow(/3-byte limit/)
    await expect(readFile(join(dir, 'large.txt'))).rejects.toThrow()
  })

  it('lists and moves files only within the downloads directory', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'report.txt'), 'payload')
    const tools = createBackgroundTools({ downloadsDir: dir, fetchFn: fetch })
    const list = tools.find((tool) => tool.name === 'list_downloads')!
    const move = tools.find((tool) => tool.name === 'move_download')!

    expect(await list.execute({ id: 'l1', name: 'list_downloads', args: {} }, CTX)).toContain('report.txt')
    await move.execute(
      { id: 'm1', name: 'move_download', args: { source: 'report.txt', destination: 'reports/final.txt' } },
      CTX,
    )
    expect(await readFile(join(dir, 'reports/final.txt'), 'utf8')).toBe('payload')
    await expect(
      move.execute(
        { id: 'm2', name: 'move_download', args: { source: 'reports/final.txt', destination: '../escape.txt' } },
        CTX,
      ),
    ).rejects.toThrow(/inside the downloads directory/)
  })

  it('rejects symlink traversal for move sources and destinations', async () => {
    const dir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(dir, 'escape'))
    const move = createBackgroundTools({ downloadsDir: dir, fetchFn: fetch }).find(
      (tool) => tool.name === 'move_download',
    )!

    await expect(
      move.execute(
        { id: 'm1', name: 'move_download', args: { source: 'escape/secret.txt', destination: 'stolen.txt' } },
        CTX,
      ),
    ).rejects.toThrow(/symlink paths/)
    await writeFile(join(dir, 'safe.txt'), 'safe')
    await expect(
      move.execute(
        { id: 'm2', name: 'move_download', args: { source: 'safe.txt', destination: 'escape/stolen.txt' } },
        CTX,
      ),
    ).rejects.toThrow(/symlink paths/)
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
  })
})
