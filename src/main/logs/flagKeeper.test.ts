import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFlagKeeper } from './flagKeeper'

const lines = (path: string): unknown[] => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

describe('the Flag keeper (#421)', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function logs(): string {
    dir = mkdtempSync(join(tmpdir(), 'flags-'))
    const at = 1_700_000_000_000
    const decisions = [
      { type: 'decision', turnId: 'turn-a', at: at - 100_000, verb: 'reload', reading: 'local_match', jevAsked: false, transcript: 'reload' },
      { type: 'decision', turnId: 'turn-t', at, verb: 'search', reading: 'jev', jevAsked: true, ask: 'turn-t', partialAsks: ['partial-1'], transcript: 'find cats', task: { id: 'turn-t', hop: 0 } },
      { type: 'decision', turnId: 'turn-t2', at: at + 1_000, verb: 'click', reading: 'jev', jevAsked: true, ask: 'turn-t2', transcript: 'find cats', task: { id: 'turn-t', hop: 1 } },
      { type: 'misfire', turnId: 'turn-t2', at: at + 2_000, signal: 'back', withinMs: 1_000 },
      { type: 'misfire', turnId: 'turn-a', at: at - 99_000, signal: 'back', withinMs: 1_000 },
    ]
    writeFileSync(join(dir, 'decision-1-1.jsonl'), `${decisions.map((record) => JSON.stringify(record)).join('\n')}\n`)
    const asks = [
      { type: 'ask', id: 'partial-1', at: at - 500, kind: 'partial', state: 's', questions: {} },
      { type: 'ask', id: 'turn-t', turnId: 'turn-t', at, kind: 'command', state: 's', questions: {} },
      { type: 'ask', id: 'turn-t2', turnId: 'turn-t2', at: at + 900, kind: 'hop', state: 's', questions: {}, images: { mark: 'ask-images/turn-t2.jpg' } },
      { type: 'ask', id: 'turn-a', turnId: 'turn-a', at: at - 100_000, kind: 'command', state: 's', questions: {} },
    ]
    writeFileSync(join(dir, 'asks-1-1.jsonl'), `${asks.map((record) => JSON.stringify(record)).join('\n')}\n`)
    mkdirSync(join(dir, 'ask-images'))
    writeFileSync(join(dir, 'ask-images', 'turn-t2.jpg'), 'marked')
    // A file last written before the Task began cannot hold it, and is not read.
    writeFileSync(join(dir, 'decision-0-1.jsonl'), `${JSON.stringify({ ...decisions[1], at: at - 9e6 })}\n`)
    utimesSync(join(dir, 'decision-0-1.jsonl'), new Date(at - 9e6), new Date(at - 9e6))
    return dir
  }

  it("copies every hop's records, its Misfires, its asks and their images, and the shot, into flags/<taskId>/", () => {
    const logsDir = logs()
    const keeper = createFlagKeeper(logsDir)
    const flag = { type: 'flag' as const, turnId: 'turn-f', taskId: 'turn-t', at: 1_700_000_010_000, hint: 'wrong video', url: 'https://example.com/' }
    expect(keeper.keep(flag, new Uint8Array([1, 2]), 1_700_000_000_000)).toBe('flags/turn-t/turn-f.jpg')
    const kept = join(logsDir, 'flags', 'turn-t')
    expect(readFileSync(join(kept, 'turn-f.jpg'))).toEqual(Buffer.from([1, 2]))
    expect(lines(join(kept, 'decision-turn-t.jsonl'))).toEqual([
      expect.objectContaining({ turnId: 'turn-t', at: 1_700_000_000_000 }),
      expect.objectContaining({ turnId: 'turn-t2' }),
      expect.objectContaining({ type: 'misfire', turnId: 'turn-t2' }),
      { ...flag, shot: 'flags/turn-t/turn-f.jpg' },
    ])
    expect(lines(join(kept, 'asks-turn-t.jsonl')).map((ask) => (ask as { id: string }).id)).toEqual(['partial-1', 'turn-t', 'turn-t2'])
    expect(readFileSync(join(kept, 'ask-images', 'turn-t2.jpg'), 'utf8')).toBe('marked')
  })

  it('a second flag of the same Task keeps both flags, and a flag with no shot names none', () => {
    const logsDir = logs()
    const keeper = createFlagKeeper(logsDir)
    const flag = { type: 'flag' as const, turnId: 'turn-f', taskId: 'turn-t', at: 1_700_000_010_000, url: '' }
    keeper.keep(flag, new Uint8Array([1]), 1_700_000_000_000)
    // The first flag is in the decision log by now, as the runner logs it.
    writeFileSync(join(logsDir, 'decision-1-1.jsonl'), `${JSON.stringify({ ...flag, shot: 'flags/turn-t/turn-f.jpg' })}\n`, { flag: 'a' })
    expect(keeper.keep({ ...flag, turnId: 'turn-g', hint: 'again' }, null, 1_700_000_000_000)).toBeNull()
    const kept = lines(join(logsDir, 'flags', 'turn-t', 'decision-turn-t.jsonl')).filter((record) => (record as { type: string }).type === 'flag')
    expect(kept).toEqual([{ ...flag, shot: 'flags/turn-t/turn-f.jpg' }, { ...flag, turnId: 'turn-g', hint: 'again' }])
    expect(readdirSync(join(logsDir, 'flags', 'turn-t')).filter((name) => name.endsWith('.jpg'))).toEqual(['turn-f.jpg'])
  })
})
