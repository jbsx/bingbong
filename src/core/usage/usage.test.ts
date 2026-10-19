import { describe, expect, it } from 'vitest'
import { chartCeiling, elapsedPct, fetchUsage, resetLabel, readUsage, usageBaseUrl, windowCaption, type UsageWindow } from './usage'

// Trimmed from the dashboard's live payloads on 2026-10-19.
const usage = {
  updatedAt: 1792373775151,
  providers: [
    { name: 'GLM', connected: true, plan: 'lite', windows: [{ key: '5h', label: '5-Hour', usedPct: 1, resetAt: 1792383375014 }] },
    { name: 'Codex', connected: true, plan: 'prolite', windows: [{ key: '7d', label: '7-Day', usedPct: 14, resetAt: 1792878205000 }] },
    {
      name: 'Claude',
      connected: true,
      plan: 'Max 20x',
      windows: [
        { key: '7d', label: '7-Day', usedPct: 83, resetAt: 1792454399686 },
        { key: '5h', label: '5-Hour', usedPct: 2, resetAt: 1792387799686 },
        { key: '7d-fable', label: '7-Day (Fable)', usedPct: 78, resetAt: 1792454399686 },
      ],
    },
  ],
}

const sample = (sampledAt: number, codex: number, claude5h: number) => ({
  sampledAt,
  providers: [
    { name: 'Codex', windows: [{ key: '7d', label: '7-Day', usedPct: codex }] },
    {
      name: 'Claude',
      windows: [
        { key: '5h', label: '5-Hour', usedPct: claude5h },
        { key: '7d', label: '7-Day', usedPct: 80 },
      ],
    },
  ],
})

const history = { samples: [sample(2_000, 14, 3), sample(1_000, 13, 2), { sampledAt: 3_000, providers: [] }] }

describe('readUsage', () => {
  it('keeps Codex then Claude, drops the other providers', () => {
    expect(readUsage(usage, history).providers.map((p) => p.name)).toEqual(['Codex', 'Claude'])
  })

  it('gauges the 5h window first, else 7d, and bars the rest', () => {
    const [codex, claude] = readUsage(usage, history).providers
    expect(codex.gauge?.key).toBe('7d')
    expect(codex.bars).toEqual([])
    expect(claude.gauge).toMatchObject({ key: '5h', caption: '5h', usedPct: 2, durationMs: 5 * 3_600_000 })
    expect(claude.bars.map((w) => w.caption)).toEqual(['7d', '7d-fab'])
  })

  it("reads the gauged window's history, oldest first, skipping samples without it", () => {
    const [codex, claude] = readUsage(usage, history).providers
    expect(codex.history).toEqual([
      [1_000, 13],
      [2_000, 14],
    ])
    expect(claude.history).toEqual([
      [1_000, 2],
      [2_000, 3],
    ])
  })

  it('leaves out a disconnected provider and survives garbage', () => {
    const offline = { providers: [{ ...usage.providers[1], connected: false }] }
    expect(readUsage(offline, null).providers).toEqual([])
    expect(readUsage('nope', 5).providers).toEqual([])
  })
})

describe('windowCaption', () => {
  it('captions as the dashboard does', () => {
    expect(windowCaption('5h')).toBe('5h')
    expect(windowCaption('7d-fable')).toBe('7d-fab')
    expect(windowCaption('monthly')).toBe('mo')
    expect(windowCaption('GPT-5.3-Codex-Spark')).toBe('Spark')
  })
})

describe('elapsedPct', () => {
  const window = (resetAt: number | null, durationMs: number | null): UsageWindow => ({
    key: '5h',
    caption: '5h',
    usedPct: 40,
    resetAt,
    durationMs,
  })

  it('is the share of the window already run', () => {
    expect(elapsedPct(window(1_000 + 3_600_000, 4 * 3_600_000), 1_000)).toBe(75)
  })

  it('is empty while unarmed and falls back to usage when the length is unknown', () => {
    expect(elapsedPct(window(null, 3_600_000), 0)).toBe(0)
    expect(elapsedPct(window(5_000, null), 0)).toBe(40)
  })
})

describe('fetchUsage', () => {
  it('asks for the usage and the last twelve hours of history', async () => {
    const urls: string[] = []
    const fetchJson = async (url: string) => {
      urls.push(url)
      return url.includes('/api/usage') ? usage : history
    }
    const now = 50 * 3_600_000
    const snapshot = await fetchUsage(fetchJson, ' http://192.168.1.73:4321/ ', now)
    expect(urls).toEqual([
      'http://192.168.1.73:4321/api/usage',
      `http://192.168.1.73:4321/api/history?from=${now - 12 * 3_600_000}&to=${now}`,
    ])
    expect(snapshot.providers).toHaveLength(2)
  })

  it('trims the base URL', () => {
    expect(usageBaseUrl('  http://h:1// ')).toBe('http://h:1')
  })
})

describe('resetLabel', () => {
  it('reads the two largest units', () => {
    expect(resetLabel(((5 * 24 + 20) * 60 + 5) * 60_000, 0)).toBe('5d 20h')
    expect(resetLabel((3 * 60 + 51) * 60_000 + 30_000, 0)).toBe('3h 51m')
    expect(resetLabel(42 * 60_000, 0)).toBe('42m')
    expect(resetLabel(-5, 0)).toBe('0m')
  })

  it('says unarmed before the window starts counting', () => {
    expect(resetLabel(null, 0)).toBe('unarmed')
  })
})

describe('chartCeiling', () => {
  it('rounds the peak up to a readable top', () => {
    expect(chartCeiling(0)).toBe(10)
    expect(chartCeiling(16)).toBe(20)
    expect(chartCeiling(19)).toBe(25)
    expect(chartCeiling(83)).toBe(100)
    expect(chartCeiling(120)).toBe(150)
  })
})
