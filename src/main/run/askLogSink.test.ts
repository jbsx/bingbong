import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAskLogSink } from './askLogSink'

describe("the asks sidecar's images (#382, ADR 0084)", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const logsDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'bingbong-asklog-'))
    dirs.push(dir)
    return dir
  }

  it("saves an ask's image beside the sidecar under the ask's id, and names the file relative to the logs dir", () => {
    const dir = logsDir()
    const bytes = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9])

    const file = createAskLogSink(dir).saveImage('cli-3-abc-mark', bytes)

    expect(file).toBe('ask-images/cli-3-abc-mark.jpg')
    expect(new Uint8Array(readFileSync(join(dir, file!)))).toEqual(bytes)
  })

  it('purges images older than the logs keep, on the next save', () => {
    const dir = logsDir()
    mkdirSync(join(dir, 'ask-images'))
    const old = join(dir, 'ask-images', 'old-mark.jpg')
    writeFileSync(old, 'x')
    const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(old, eightDaysAgo, eightDaysAgo)

    createAskLogSink(dir).saveImage('new-mark', new Uint8Array([1]))

    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(dir, 'ask-images', 'new-mark.jpg'))).toBe(true)
  })
})
