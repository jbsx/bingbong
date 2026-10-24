import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBrightness, parseDetect } from '../../core/idle/ddc'
import { createDdcutilRun, createScriptedDdcRun } from './ddcRun'

describe('ddcRun', () => {
  it('runs ddcutil one call at a time, each bounded by the timeout', async () => {
    const seen: string[] = []
    let running = 0
    const run = createDdcutilRun({
      timeoutMs: 1234,
      exec: async (file, args, timeoutMs) => {
        running += 1
        seen.push(`${file} ${args.join(' ')} ${timeoutMs} overlap=${running > 1}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running -= 1
        if (args.includes('setvcp')) throw new Error('setvcp failed')
        return 'out'
      },
    })
    const calls = [run(['--bus', '0', 'setvcp', '10', '16']), run(['--bus', '0', 'getvcp', '10', '--terse'])]
    await expect(calls[0]).rejects.toThrow('setvcp failed')
    await expect(calls[1]).resolves.toBe('out')
    expect(seen).toEqual(['ddcutil --bus 0 setvcp 10 16 1234 overlap=false', 'ddcutil --bus 0 getvcp 10 --terse 1234 overlap=false'])
  })

  it('stands in for ddcutil with a scripted monitor, logging each call', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'ddc-')), 'calls.log')
    const run = createScriptedDdcRun(JSON.stringify({ displays: [{ bus: 4, connector: 'card0-HDMI-A-1', monitor: 'PHL:PHL 325E1:UK0' }], level: 40, log }))
    expect(parseDetect(await run(['detect', '--terse']))).toEqual([{ bus: 4, model: 'PHL 325E1', connector: 'HDMI-A-1' }])
    await run(['--bus', '4', 'setvcp', '10', '16'])
    expect(parseBrightness(await run(['--bus', '4', 'getvcp', '10', '--terse']))).toEqual({ current: 16, max: 100 })
    expect(readFileSync(log, 'utf8')).toBe('detect --terse\n--bus 4 setvcp 10 16\n--bus 4 getvcp 10 --terse\n')
  })

  it('scripts ddcutil missing, no monitor, or a failing call', async () => {
    await expect(createScriptedDdcRun('{"missing": true}')(['detect', '--terse'])).rejects.toMatchObject({ code: 'ENOENT' })
    expect(parseDetect(await createScriptedDdcRun('{}')(['detect', '--terse']))).toEqual([])
    const failing = createScriptedDdcRun(JSON.stringify({ displays: [{ bus: 0, connector: 'card0-DP-1', monitor: 'DEL:U2415:X' }], fail: 'set' }))
    await expect(failing(['--bus', '0', 'setvcp', '10', '5'])).rejects.toThrow('timed out')
    expect(() => createScriptedDdcRun('[1]')).toThrow(/BINGBONG_DDC_SCRIPT/)
  })
})
