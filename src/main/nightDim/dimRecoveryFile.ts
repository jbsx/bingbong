import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { DimRecoveryStore } from '../../core/idle/monitorDim'
import { reportFault } from '../../core/trace/fault'

/**
 * `<userData>/night-dim.json` (#413): the day level, written before a
 * monitor or a backlight goes down and deleted once it is back up, so a crash at night
 * leaves the next boot what to restore. Written synchronously: the record
 * is on disk before the call that lowers the monitor starts.
 */
export function createDimRecoveryFile(path: string): DimRecoveryStore {
  return {
    read() {
      // No file is the usual case: nothing was left down.
      if (!existsSync(path)) return null
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(path, 'utf8'))
      } catch (error) {
        reportFault('idle.dimRecoveryFile.read', error)
        return null
      }
      const record = raw as { model?: unknown; connector?: unknown; bus?: unknown; backlight?: unknown; dayLevel?: unknown } | null
      if (typeof record?.model !== 'string' || typeof record.connector !== 'string' || !Number.isInteger(record.dayLevel)) return null
      const { model, connector } = record
      const dayLevel = record.dayLevel as number
      // A built-in panel by its backlight's name, a monitor by its bus.
      if (typeof record.backlight === 'string' && record.backlight !== '') return { model, connector, backlight: record.backlight, dayLevel }
      return Number.isInteger(record.bus) ? { model, connector, bus: record.bus as number, dayLevel } : null
    },
    write(record) {
      writeFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
    },
    clear() {
      try {
        rmSync(path, { force: true })
      } catch (error) {
        reportFault('idle.dimRecoveryFile.clear', error)
      }
    },
  }
}
