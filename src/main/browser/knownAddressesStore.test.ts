import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createKnownAddressStore } from './knownAddressesStore'

// The Known Addresses' persistence (#408): hosts.json in userData. The
// ledger's rules live in core and are tested there; these pin the file: a
// host survives a restart, and a corrupt file fails closed to none.

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function hostsPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bingbong-hosts-'))
  dirs.push(dir)
  return join(dir, 'hosts.json')
}

describe('the Known Address store', () => {
  it('knows a host landed on after a restart', async () => {
    const path = await hostsPath()
    createKnownAddressStore(path).record({ url: 'https://www.youtube.com/watch?v=x' })
    expect(createKnownAddressStore(path).addressOf('youtube')).toBe('youtube.com')
  })

  it('fails closed to no hosts on a corrupt file', async () => {
    const path = await hostsPath()
    await writeFile(path, '{not json', 'utf8')
    expect(createKnownAddressStore(path).addressOf('youtube')).toBeNull()
  })
})
