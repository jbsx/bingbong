import { describe, expect, it } from 'vitest'
import {
  chartCeiling,
  defaultGauge,
  defaultUsagePrefs,
  elapsedPct,
  fetchUsage,
  pace,
  readUsage,
  resetLabel,
  sanitizeUsagePrefs,
  usageBaseUrl,
  viewUsage,
  windowCaption,
  type UsagePrefs,
  type UsageWindow,
} from './usage'

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
  it('keeps every provider the dashboard reports, in its order', () => {
    expect(readUsage(usage, history).providers.map((p) => p.name)).toEqual(['GLM', 'Codex', 'Claude'])
  })

  it("gives each window its caption, length and history, oldest first", () => {
    const claude = readUsage(usage, history).providers[2]
    expect(claude.windows.map((w) => w.caption)).toEqual(['7d', '5h', '7d-fab'])
    expect(claude.windows[1]).toMatchObject({ key: '5h', label: '5-Hour', usedPct: 2, durationMs: 5 * 3_600_000 })
    expect(claude.windows[1].history).toEqual([
      [1_000, 2],
      [2_000, 3],
    ])
    expect(claude.windows[2].history).toEqual([])
  })

  it('marks a disconnected provider and survives garbage', () => {
    const offline = { providers: [{ ...usage.providers[1], connected: false }] }
    expect(readUsage(offline, null).providers[0].connected).toBe(false)
    expect(readUsage('nope', 5).providers).toEqual([])
  })
})

describe('viewUsage', () => {
  const snapshot = readUsage(usage, history)
  const view = (prefs: Partial<UsagePrefs>) => viewUsage(snapshot, { ...defaultUsagePrefs(), ...prefs })

  it('shows Codex and Claude by default, gauging the window closest to its limit and charting the gauge', () => {
    const [codex, claude] = view({})
    expect(view({}).map((p) => p.name)).toEqual(['Codex', 'Claude'])
    expect(codex.gauge?.key).toBe('7d')
    expect(codex.lines.map((w) => w.key)).toEqual(['7d'])
    // 7d at 83 % is the one that will stop you, not 5h at 2 %.
    expect(claude.gauge?.key).toBe('7d')
    expect(claude.bars.map((w) => w.key)).toEqual(['5h', '7d-fable'])
    expect(claude.lines.map((w) => w.key)).toEqual(['7d'])
  })

  it('breaks a tie the dashboard\'s way: 5h, else 7d, else the first', () => {
    const tied = (keys: string[]): string | undefined =>
      defaultGauge(keys.map((key) => ({ key, caption: key, label: key, usedPct: 40, resetAt: null, durationMs: null, history: [] }))
      )?.key
    expect(tied(['7d', '5h'])).toBe('5h')
    expect(tied(['monthly', '7d'])).toBe('7d')
    expect(tied(['monthly', 'weekly'])).toBe('monthly')
    expect(defaultGauge([])).toBeNull()
  })

  it("shows the chosen providers in the dashboard's order and drops a disconnected one", () => {
    expect(view({ providers: ['Claude', 'GLM'] }).map((p) => p.name)).toEqual(['GLM', 'Claude'])
    const offline = readUsage({ providers: [{ ...usage.providers[1], connected: false }] }, null)
    expect(viewUsage(offline, defaultUsagePrefs())).toEqual([])
  })

  it('hides windows, takes the chosen gauge while it is shown, and charts the chosen lines', () => {
    const [claude] = view({ providers: ['Claude'], metrics: { Claude: { hidden: ['7d-fable'], gauge: '7d', chart: ['5h', '7d-fable'] } } })
    expect(claude.gauge?.key).toBe('7d')
    expect(claude.bars.map((w) => w.key)).toEqual(['5h'])
    expect(claude.lines.map((w) => w.key)).toEqual(['5h', '7d-fable'])
    const [fallback] = view({ providers: ['Claude'], metrics: { Claude: { hidden: ['5h'], gauge: '5h', chart: [] } } })
    expect(fallback.gauge?.key).toBe('7d')
    expect(fallback.lines).toEqual([])
  })
})

describe('sanitizeUsagePrefs', () => {
  it('keeps valid choices and drops the rest', () => {
    expect(sanitizeUsagePrefs({ providers: ['GLM', 3, 'GLM'], metrics: { GLM: { hidden: ['5h', 1], gauge: 2, chart: ['5h'] }, Bad: 'x' } })).toEqual({
      providers: ['GLM'],
      metrics: { GLM: { hidden: ['5h'], gauge: null, chart: ['5h'] } },
    })
  })

  it('falls back to Codex and Claude, an empty list staying empty', () => {
    expect(sanitizeUsagePrefs(undefined)).toEqual(defaultUsagePrefs())
    expect(sanitizeUsagePrefs({ url: 'x' }).providers).toEqual(['Codex', 'Claude'])
    expect(sanitizeUsagePrefs({ providers: [] }).providers).toEqual([])
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
    label: '5-Hour',
    usedPct: 40,
    history: [],
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

describe('pace', () => {
  const HOUR = 3_600_000
  const window = (usedPct: number, leftMs: number | null, durationMs: number | null): UsageWindow => ({
    key: '7d',
    caption: '7d',
    label: '7-Day',
    usedPct,
    history: [],
    resetAt: leftMs === null ? null : leftMs,
    durationMs,
  })

  it('is the share used past the share of the window run, in whole points — round 6’s Claude: 10 % with 6d 15h of 7d left is +5', () => {
    expect(pace(window(10, (6 * 24 + 15) * HOUR, 168 * HOUR), 0)).toBe(5)
  })

  it('is nothing while the use is at or behind the window', () => {
    expect(pace(window(0, (6 * 24 + 23) * HOUR, 168 * HOUR), 0)).toBeNull()
    expect(pace(window(23, 120 * HOUR, 168 * HOUR), 0)).toBeNull()
  })

  it('is nothing for a window unarmed or of unknown length', () => {
    expect(pace(window(50, null, 168 * HOUR), 0)).toBeNull()
    expect(pace(window(50, 10 * HOUR, null), 0)).toBeNull()
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
    expect(snapshot.providers).toHaveLength(3)
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
  })

  it('never runs past 100, however near or past full the peak is', () => {
    expect(chartCeiling(95)).toBe(100)
    expect(chartCeiling(120)).toBe(100)
  })
})
