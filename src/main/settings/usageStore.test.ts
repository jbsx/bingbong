import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createUsageStore } from './usageStore'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('usage store', () => {
  it('reports a fresh zero day after midnight without waiting for another request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bingbong-usage-'))
    dirs.push(dir)
    let now = new Date(2026, 7, 17, 23, 59).getTime()
    const store = createUsageStore(join(dir, 'usage.json'), { now: () => now })
    store.record('orchestrator', 'glm-4.6', { promptTokens: 100, completionTokens: 20 })
    expect(store.summary(5).requests).toBe(1)

    now = new Date(2026, 7, 18, 0, 1).getTime()

    expect(store.summary(5)).toMatchObject({ date: '2026-08-18', requests: 0, estimateUsd: 0 })
  })
})
