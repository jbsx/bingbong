import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reportFault, setFaultSink } from '../../core/trace/fault'
import { createFaultLogSink } from './faultLogSink'

describe('the fault log (#397)', () => {
  const dirs: string[] = []
  afterEach(() => {
    setFaultSink(null)
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const logsDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'bingbong-faultlog-'))
    dirs.push(dir)
    return dir
  }

  it('lands a swallowed fault as one stamped line in faults-*.jsonl', () => {
    const dir = logsDir()
    setFaultSink(createFaultLogSink(dir, { now: () => 1_761_200_000_000 }))

    reportFault('scale.bluez.session', new Error('the scale disconnected before its services resolved'), { turnId: 't-1' })
    reportFault('voice.stt.transcribe', 'timed out')

    const files = readdirSync(dir)
    expect(files).toEqual([expect.stringMatching(/^faults-.*\.jsonl$/)])
    const lines = readFileSync(join(dir, files[0]!), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(lines).toEqual([
      expect.objectContaining({
        at: 1_761_200_000_000,
        kind: 'fault',
        site: 'scale.bluez.session',
        message: 'the scale disconnected before its services resolved',
        stack: expect.stringContaining('Error'),
        turnId: 't-1',
      }),
      { at: 1_761_200_000_000, kind: 'fault', site: 'voice.stt.transcribe', message: 'timed out' },
    ])
  })
})
