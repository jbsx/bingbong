import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { DimRecord, DimRecoveryStore } from '../../core/idle/monitorDim'
import { reportFault } from '../../core/trace/fault'

/**
 * `<userData>/night-dim.json` (#413): the day level, written before a
 * monitor goes down and deleted once it is back up, so a crash at night
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
      const record = raw as Partial<DimRecord> | null
      if (typeof record?.model !== 'string' || typeof record.connector !== 'string' || !Number.isInteger(record.bus) || !Number.isInteger(record.dayLevel)) return null
      return { model: record.model, connector: record.connector, bus: record.bus as number, dayLevel: record.dayLevel as number }
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
