import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDimRecoveryFile } from './dimRecoveryFile'

describe('dimRecoveryFile', () => {
  it('keeps the day level on disk until it is cleared', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'night-dim-')), 'night-dim.json')
    const file = createDimRecoveryFile(path)
    expect(file.read()).toBeNull()
    file.write({ model: 'PHL 325E1', connector: 'HDMI-A-1', bus: 0, dayLevel: 40 })
    expect(createDimRecoveryFile(path).read()).toEqual({ model: 'PHL 325E1', connector: 'HDMI-A-1', bus: 0, dayLevel: 40 })
    file.clear()
    expect(existsSync(path)).toBe(false)
    expect(file.read()).toBeNull()
  })

  it('reads a broken record as none', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'night-dim-')), 'night-dim.json')
    writeFileSync(path, '{"model": "PHL 325E1"}')
    expect(createDimRecoveryFile(path).read()).toBeNull()
    writeFileSync(path, 'not json')
    expect(createDimRecoveryFile(path).read()).toBeNull()
  })
})
