import { describe, expect, it } from 'vitest'
import { claimOf, countByStage, formatLedger, orderFailedLines, readFailedLine, statusOf, type FailedLine } from './failedLine'

// A Failed Line (#371): the ledger entry, and the widest-net view `pnpm bugs`
// prints — counts per first failing stage, open and unclaimed first.

const line = (over: Partial<FailedLine> & { turnId: string }): FailedLine => ({
  transcript: 'loop the song',
  at: 1_000,
  source: 'spoken',
  stage: 'reading',
  happened: 'clicked the captions button',
  meant: 'loop the song',
  ...over,
})

describe('readFailedLine', () => {
  it('reads an entry with every field', () => {
    const raw = { ...line({ turnId: 't1' }), log: 'decision-1-1.jsonl', claimedBy: '#371', fixedBy: 'abc1234', case: 't1', ruled: 'accepted' }
    expect(readFailedLine(raw)).toEqual(raw)
  })

  it('drops nothing it was not given', () => {
    expect(readFailedLine(line({ turnId: 't1' }))).toEqual(line({ turnId: 't1' }))
  })

  it.each([
    [{ ...line({ turnId: 't1' }), turnId: '' }, 'turnId is not a non-empty string'],
    [{ ...line({ turnId: 't1' }), meant: 3 }, 'meant is not a non-empty string'],
    [{ ...line({ turnId: 't1' }), at: 'now' }, 'at is not a number'],
    [{ ...line({ turnId: 't1' }), source: 'sung' }, 'source is not spoken or typed'],
    [{ ...line({ turnId: 't1' }), stage: 'vibes' }, 'stage is not one of stt, turn, local_match, reading, missing_option, runner, player, page'],
    [{ ...line({ turnId: 't1' }), claimedBy: '371' }, 'claimedBy is not #<issue>'],
    [{ ...line({ turnId: 't1' }), fixedBy: '' }, 'fixedBy is not a non-empty string'],
    ['a string', 'not an object'],
    [null, 'not an object'],
  ])('refuses a malformed entry with the reason: %j', (raw, reason) => {
    expect(readFailedLine(raw)).toBe(reason)
  })
})

describe('statusOf and claimOf', () => {
  it('is open until fixed or ruled', () => {
    expect(statusOf(line({ turnId: 't1' }))).toBe('open')
    expect(statusOf(line({ turnId: 't1', claimedBy: '#371' }))).toBe('open')
    expect(statusOf(line({ turnId: 't1', fixedBy: 'abc1234' }))).toBe('fixed')
    expect(statusOf(line({ turnId: 't1', ruled: 'the owner accepts it' }))).toBe('ruled')
  })

  it('tells the claim', () => {
    expect(claimOf(line({ turnId: 't1' }))).toBe('unclaimed')
    expect(claimOf(line({ turnId: 't1', claimedBy: '#371' }))).toBe('claimed by #371')
    expect(claimOf(line({ turnId: 't1', claimedBy: '#370', fixedBy: '0aacca0', case: 'turn-1' }))).toBe('fixed 0aacca0 (#370), guarded by turn-1')
    expect(claimOf(line({ turnId: 't1', fixedBy: '0aacca0' }))).toBe('fixed 0aacca0')
    expect(claimOf(line({ turnId: 't1', ruled: 'STT, accepted' }))).toBe('ruled: STT, accepted')
  })
})

describe('orderFailedLines', () => {
  it('puts open and unclaimed first, then open and claimed, then fixed and ruled, newest first within each', () => {
    const lines = [
      line({ turnId: 'fixed-old', at: 1, fixedBy: 'a' }),
      line({ turnId: 'claimed', at: 2, claimedBy: '#1' }),
      line({ turnId: 'open-old', at: 3 }),
      line({ turnId: 'ruled', at: 4, ruled: 'ok' }),
      line({ turnId: 'open-new', at: 5 }),
      line({ turnId: 'fixed-new', at: 6, fixedBy: 'b' }),
    ]
    expect(orderFailedLines(lines).map((entry) => entry.turnId)).toEqual(['open-new', 'open-old', 'claimed', 'fixed-new', 'ruled', 'fixed-old'])
  })
})

describe('countByStage', () => {
  it('counts open, claimed, fixed and ruled per stage, most open first', () => {
    const lines = [
      line({ turnId: 'a', stage: 'stt' }),
      line({ turnId: 'b', stage: 'reading' }),
      line({ turnId: 'c', stage: 'reading', claimedBy: '#1' }),
      line({ turnId: 'd', stage: 'reading', fixedBy: 'x' }),
      line({ turnId: 'e', stage: 'page', ruled: 'ok' }),
    ]
    expect(countByStage(lines)).toEqual([
      { stage: 'reading', open: 2, claimed: 1, fixed: 1, ruled: 0 },
      { stage: 'stt', open: 1, claimed: 0, fixed: 0, ruled: 0 },
      { stage: 'page', open: 0, claimed: 0, fixed: 0, ruled: 1 },
    ])
  })

  it('breaks a tie on open lines by closed ones, then the pipeline order', () => {
    const lines = [line({ turnId: 'a', stage: 'page' }), line({ turnId: 'b', stage: 'stt' }), line({ turnId: 'c', stage: 'runner' }), line({ turnId: 'd', stage: 'runner', fixedBy: 'x' })]
    expect(countByStage(lines).map((count) => count.stage)).toEqual(['runner', 'stt', 'page'])
  })
})

describe('formatLedger', () => {
  it('says when the ledger is empty, and how to add', () => {
    expect(formatLedger([], '/ledger')).toBe('no failed lines in /ledger\nadd one: pnpm bugs:add <turnId> --stage <stage> --happened "…" --meant "…"')
  })

  it('prints the totals, the stage table and every line under its stage', () => {
    const lines = [
      line({ turnId: 'open-1', stage: 'reading', at: Date.UTC(2026, 9, 21, 11, 53), transcript: 'Turn on ambient mode.', happened: 'none 0.51', meant: 'ambient mode on' }),
      line({ turnId: 'fixed-1', stage: 'reading', at: Date.UTC(2026, 9, 20, 22, 59), transcript: 'enable captions', happened: 'show fired', meant: 'captions on', claimedBy: '#370', fixedBy: '0aacca0', case: 'fixed-1' }),
      line({ turnId: 'stt-1', stage: 'stt', at: Date.UTC(2026, 9, 21, 11, 50), transcript: 'Click Highs and Lows by Canywast.', happened: 'heard Canywast', meant: 'Kanye West', ruled: 'STT' }),
    ]
    const report = formatLedger(lines, '/ledger')
    expect(report).toContain('3 failed lines in /ledger: 1 open (1 unclaimed), 1 fixed, 1 ruled')
    expect(report).toContain('stage           open   claimed  fixed  ruled')
    expect(report).toContain('reading         1      0        1      0')
    expect(report).toContain('stt             0      0        0      1')
    expect(report).toContain('## reading — Jev picked wrong among options that existed — 1 open')
    expect(report).toContain('open-1  ')
    expect(report).toContain('  spoken  "Turn on ambient mode."\n  happened: none 0.51\n  meant:    ambient mode on\n  unclaimed')
    expect(report).toContain('  fixed 0aacca0 (#370), guarded by fixed-1')
    expect(report).toContain('## stt — the words heard were not the words said — 0 open')
    expect(report).toContain('  ruled: STT')
    // The open line comes before the fixed one under its stage.
    expect(report.indexOf('open-1')).toBeLessThan(report.indexOf('fixed-1'))
    // Stages with open lines come first.
    expect(report.indexOf('## reading')).toBeLessThan(report.indexOf('## stt'))
  })
})
