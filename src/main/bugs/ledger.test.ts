import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FailedLine } from '../../core/bugs/failedLine'
import { addFailedLine, formatBugCandidates, ledgerLines, listBugCandidates, readLedger } from './ledger'

// The Failed Lines ledger on disk (#371): the candidate signals over a logs
// dir, and an entry written from a logged turn or updated in place.

const jsonl = (records: readonly object[]): string => records.map((record) => JSON.stringify(record)).join('\n') + '\n'

const decision = (turnId: string, at: number, transcript: string, over: Record<string, unknown> = {}): object => ({
  type: 'decision',
  turnId,
  at,
  source: 'spoken',
  transcript,
  reading: 'jev',
  verb: 'click',
  target: 1,
  slot: null,
  jevAsked: true,
  ...over,
})

const entry = (turnId: string): FailedLine => ({ turnId, transcript: 'x', at: 1, source: 'spoken', stage: 'reading', happened: 'h', meant: 'm' })

describe('listBugCandidates', () => {
  let logs: string

  beforeEach(() => {
    logs = mkdtempSync(join(tmpdir(), 'bingbong-bugs-'))
  })

  afterEach(() => {
    rmSync(logs, { recursive: true, force: true })
  })

  const candidates = (records: readonly object[], ledger: readonly FailedLine[] = []) => {
    writeFileSync(join(logs, 'decision-1-1.jsonl'), jsonl(records))
    return listBugCandidates(logs, ledger)
  }

  it('flags the first of the same words said again within 30 s, ignoring case and punctuation', () => {
    const found = candidates([decision('t1', 1_000, 'Loop the song.'), decision('t2', 20_000, 'loop the song'), decision('t3', 60_000, 'loop the song')])
    expect(found).toEqual([{ turnId: 't1', at: 1_000, transcript: 'Loop the song.', signals: ['repeat'] }])
  })

  it('does not read a scroll said again as a retry', () => {
    expect(candidates([decision('t1', 1_000, 'scroll down', { verb: 'scroll_down' }), decision('t2', 2_000, 'scroll down', { verb: 'scroll_down' })])).toEqual([])
  })

  it.each(['cap', 'unsure', 'wall', 'unchanged', 'not_found'])('flags the Task whose last hop ended %s', (ended) => {
    const found = candidates([decision('t1', 1_000, 'open it'), decision('t1-hop1', 2_000, 'open it', { task: { id: 't1', hop: 1 }, ended })])
    expect(found).toEqual([{ turnId: 't1', at: 1_000, transcript: 'open it', signals: [`ended:${ended}`] }])
  })

  it.each(['done', 'terminal', 'local_match'])('does not flag a Task that ended %s', (ended) => {
    expect(candidates([decision('t1', 1_000, 'open it', { ended })])).toEqual([])
  })

  it('flags a hop-0 none Jev was unsure of, not a sure one', () => {
    const none = (turnId: string, action: number) => decision(turnId, 1_000, 'hmm', { verb: 'none', target: null, jev: { model: 'jev', latencyMs: 1, confidence: { action, slot: 1 }, probabilities: { action: { none: action }, slot: {} } } })
    expect(candidates([none('t1', 0.51)]).map((c) => c.signals)).toEqual([['none']])
    expect(candidates([none('t2', 0.9)])).toEqual([])
  })

  it('flags a Command followed within 15 s by resume or a bare play, not the resume itself', () => {
    const found = candidates([decision('t1', 1_000, 'next song', { verb: 'play', reading: 'local_match' }), decision('t2', 5_000, 'resume', { verb: 'resume', reading: 'local_match', target: null }), decision('t3', 8_000, 'play', { verb: 'play', reading: 'local_match', target: null, music: { kind: 'unpause' } })])
    expect(found).toEqual([{ turnId: 't1', at: 1_000, transcript: 'next song', signals: ['resumed'] }])
  })

  it('does not read a play that opened a song as a resume', () => {
    expect(candidates([decision('t1', 1_000, 'next song', { verb: 'play', music: { kind: 'skip' } }), decision('t2', 5_000, 'play x', { verb: 'play', slot: 'x', video: 'v', music: { kind: 'search', place: 'now' } })])).toEqual([])
  })

  it('reads a bare play logged before #374, with no music, by its missing Slot and video', () => {
    expect(candidates([decision('t1', 1_000, 'stop'), decision('t2', 5_000, 'play', { verb: 'play', target: null })]).map((found) => found.turnId)).toEqual(['t1'])
    expect(candidates([decision('t1', 1_000, 'stop'), decision('t2', 5_000, 'loop it', { verb: 'play', target: null, capability: 'loop' })])).toEqual([])
  })

  it('flags the Task the runner undid in, and a Misfire signal, once each', () => {
    const found = candidates([
      decision('t1', 1_000, 'skip ahead'),
      decision('t1-undo', 2_000, 'skip ahead', { task: { id: 't1', hop: 4 }, undo: true, verb: 'press' }),
      decision('t1-undo2', 2_500, 'skip ahead', { task: { id: 't1', hop: 4 }, undo: true, verb: 'click' }),
      { type: 'misfire', turnId: 't1', at: 3_000, signal: 'back', withinMs: 800 },
    ])
    expect(found).toEqual([{ turnId: 't1', at: 1_000, transcript: 'skip ahead', signals: ['undo', 'misfire:back'] }])
  })

  it('leaves out the Tasks the ledger holds, and orders by time', () => {
    const found = candidates([decision('t2', 5_000, 'b', { ended: 'cap' }), decision('t1', 1_000, 'a', { ended: 'wall' }), decision('t3', 9_000, 'c', { ended: 'unsure' })], [entry('t2')])
    expect(found.map((c) => c.turnId)).toEqual(['t1', 't3'])
  })

  const flag = (turnId: string, taskId: string, at: number, hint?: string): object => ({ type: 'flag', turnId, taskId, at, url: 'https://example.com/', ...(hint !== undefined ? { hint } : {}) })

  it('lists a flagged Task first, once, with every hint said of it (#421)', () => {
    const found = candidates([decision('t1', 1_000, 'a', { ended: 'wall' }), decision('t2', 5_000, 'open cats'), flag('f1', 't2', 9_000, "couldn't load the page"), flag('f2', 't2', 9_500, 'again'), flag('f3', 't2', 9_800)])
    expect(found).toEqual([
      { turnId: 't2', at: 5_000, transcript: 'open cats', signals: ['flagged'], hints: ["couldn't load the page", 'again'] },
      { turnId: 't1', at: 1_000, transcript: 'a', signals: ['ended:wall'] },
    ])
    expect(formatBugCandidates(found, logs).split('\n')[0]).toMatch(/^t2  .*  "open cats"  flagged  hint: "couldn't load the page"; "again"$/)
  })

  it('reads a flagged Task from its flag copy once the decision log has rolled away (#421)', () => {
    const kept = join(logs, 'flags', 't2')
    mkdirSync(kept, { recursive: true })
    writeFileSync(join(kept, 'decision-t2.jsonl'), jsonl([decision('t2', 5_000, 'open cats'), flag('f1', 't2', 9_000, 'wrong')]))
    // The live log still holds the flag itself: it is read once.
    expect(candidates([flag('f1', 't2', 9_000, 'wrong')])).toEqual([{ turnId: 't2', at: 5_000, transcript: 'open cats', signals: ['flagged'], hints: ['wrong'] }])
  })

  it('formats each candidate with its signals, and says when there are none', () => {
    const found = candidates([decision('t1', Date.UTC(2026, 9, 21, 11, 52), 'Skip 10 seconds ahead.', { ended: 'cap' })])
    const report = formatBugCandidates(found, logs)
    expect(report).toMatch(/^t1  2026-10-21 \d\d:\d\d  "Skip 10 seconds ahead."  ended:cap\n\nadd one: pnpm bugs:add/)
    expect(formatBugCandidates([], logs)).toBe(`no failed-looking lines in ${logs} that the ledger does not hold`)
  })
})

describe('the ledger folder', () => {
  let dir: string
  let logs: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bingbong-ledger-'))
    logs = mkdtempSync(join(tmpdir(), 'bingbong-ledger-logs-'))
    writeFileSync(join(logs, 'decision-1-1.jsonl'), jsonl([decision('t1', 1_000, 'Skip 10 seconds ahead.'), decision('t1-hop1', 2_000, 'Skip 10 seconds ahead.', { task: { id: 't1', hop: 1 } })]))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(logs, { recursive: true, force: true })
  })

  it('reads every entry, and says which file is not one', () => {
    writeFileSync(join(dir, 'ok.json'), JSON.stringify(entry('ok')))
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ turnId: 'bad' }))
    writeFileSync(join(dir, 'broken.json'), '{')
    writeFileSync(join(dir, 'README.md'), '# not read')
    const { lines, problems } = ledgerLines(readLedger(dir))
    expect(lines.map((line) => line.turnId)).toEqual(['ok'])
    expect(problems).toEqual(['bad.json: not an entry: transcript is not a non-empty string', expect.stringMatching(/^broken\.json: not an entry: /)])
  })

  it('is empty when the folder does not exist', () => {
    expect(readLedger(join(dir, 'none'))).toEqual([])
  })

  it('writes an entry from the logged hop-0 record', () => {
    const made = addFailedLine(logs, dir, 't1', { stage: 'missing_option', happened: 'clicked the time display', meant: 'seek 10 s', claimedBy: '#371' })
    expect(made).toEqual({ path: join(dir, 't1.json'), replaced: false })
    expect(JSON.parse(readFileSync(join(dir, 't1.json'), 'utf8'))).toEqual({
      turnId: 't1',
      transcript: 'Skip 10 seconds ahead.',
      at: 1_000,
      source: 'spoken',
      log: 'decision-1-1.jsonl',
      stage: 'missing_option',
      happened: 'clicked the time display',
      meant: 'seek 10 s',
      claimedBy: '#371',
    })
  })

  it('updates the fix, the guard, the ruling or the stage of an entry it has', () => {
    addFailedLine(logs, dir, 't1', { stage: 'missing_option', happened: 'h', meant: 'm' })
    expect(addFailedLine(logs, dir, 't1', { fixedBy: 'abc1234', case: 'jev-case-1' })).toEqual({ path: join(dir, 't1.json'), replaced: true })
    const updated = JSON.parse(readFileSync(join(dir, 't1.json'), 'utf8'))
    expect(updated).toMatchObject({ stage: 'missing_option', happened: 'h', fixedBy: 'abc1234', case: 'jev-case-1' })
    addFailedLine(logs, dir, 't1', { stage: 'runner', ruled: 'accepted' })
    expect(JSON.parse(readFileSync(join(dir, 't1.json'), 'utf8'))).toMatchObject({ stage: 'runner', ruled: 'accepted', fixedBy: 'abc1234' })
  })

  it("takes a flag's hints as what happened, and finds the turn in its flag copy once the logs have rolled (#421)", () => {
    const kept = join(logs, 'flags', 't7')
    mkdirSync(kept, { recursive: true })
    writeFileSync(join(kept, 'decision-t7.jsonl'), jsonl([decision('t7', 7_000, 'play cats'), { type: 'flag', turnId: 'f1', taskId: 't7', at: 8_000, url: '', hint: 'wrong video' }]))
    expect(addFailedLine(logs, dir, 't7', { stage: 'reading', meant: 'the cats video' })).toEqual({ path: join(dir, 't7.json'), replaced: false })
    expect(JSON.parse(readFileSync(join(dir, 't7.json'), 'utf8'))).toMatchObject({ turnId: 't7', transcript: 'play cats', log: 'flags/t7/decision-t7.jsonl', happened: 'wrong video', meant: 'the cats video' })
    // A happened given wins over the hint.
    expect(addFailedLine(logs, dir, 't7', { happened: 'opened the dogs video' })).toMatchObject({ replaced: true })
    expect(JSON.parse(readFileSync(join(dir, 't7.json'), 'utf8'))).toMatchObject({ happened: 'opened the dogs video' })
  })

  it('refuses an unknown stage, a bad claim, a new entry missing a line, a turn the logs do not hold, and a file that is not an entry', () => {
    expect(addFailedLine(logs, dir, 't1', { stage: 'vibes', happened: 'h', meant: 'm' })).toEqual({ error: '"vibes" is not a stage: stt, turn, local_match, reading, missing_option, runner, player or page' })
    expect(addFailedLine(logs, dir, 't1', { stage: 'stt', happened: 'h', meant: 'm', claimedBy: '371' })).toEqual({ error: '"371" is not #<issue>' })
    expect(addFailedLine(logs, dir, 't1', { stage: 'stt', happened: 'h' })).toEqual({ error: 'no entry for t1 yet: --stage, --happened and --meant are needed' })
    expect(addFailedLine(logs, dir, 't9', { stage: 'stt', happened: 'h', meant: 'm' })).toEqual({ error: `no decision record for t9 in ${logs}` })
    writeFileSync(join(dir, 'bad.json'), '{')
    expect(addFailedLine(logs, dir, 'bad', { fixedBy: 'x' })).toEqual({ error: expect.stringMatching(/^.*bad\.json is not an entry: /) })
    expect(readLedger(dir).map((e) => e.name)).toEqual(['bad'])
  })
})
