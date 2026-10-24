import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FlagKeeper } from '../../core/command/decisionRecord'
import { reportFault } from '../../core/trace/fault.ts'
import { ASK_FILE_PATTERN, DECISION_FILE_PATTERN } from '../perf/perfFiles.ts'

// The Flag keeper (#421): a flagged Task's records copied out of the
// rolling logs into `<logs>/flags/<taskId>/` — its decision records, their
// Misfires and every Flag of it in `decision-<taskId>.jsonl`, its asks in
// `asks-<taskId>.jsonl` with their images, and each flag's shot as
// `<turnId>.jpg`. The purge in jsonlSink reads only the logs dir's own
// files, so the folder outlives them; the Log Bucket uploads it as it is.
// Imports carry .ts extensions (#36): the bugs:* scripts read the folder
// name unbundled under node's type stripping.

/** The folder under the logs dir the flags are kept in. */
export const FLAGS_DIR = 'flags'

/** Where one Task's flag copy lives. */
export function flagDirOf(logsDir: string, taskId: string): string {
  return join(logsDir, FLAGS_DIR, taskId)
}

/** An ask is made before the hop that fires on it; this much before the Task began still holds its asks. */
const ASKED_BEFORE_MS = 60_000

/** The lines of a family's files written since `since`: a file last written before cannot hold the Task. */
function linesSince(logsDir: string, pattern: RegExp, since: number): string[] {
  let names: string[]
  try {
    names = readdirSync(logsDir).filter((name) => pattern.test(name)).sort()
  } catch (error) {
    reportFault('logs.flagKeeper.listFiles', error)
    return []
  }
  const lines: string[] = []
  for (const name of names) {
    const path = join(logsDir, name)
    try {
      if (statSync(path).mtimeMs < since) continue
      lines.push(...readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== ''))
    } catch (error) {
      reportFault('logs.flagKeeper.readFile', error)
    }
  }
  return lines
}

function parsed(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch (error) {
    reportFault('logs.flagKeeper.parseLine', error)
    return null
  }
}

export function createFlagKeeper(logsDir: string): FlagKeeper {
  return {
    keep(flag, shot, taskAt) {
      const dir = flagDirOf(logsDir, flag.taskId)
      mkdirSync(dir, { recursive: true })
      const shotPath = shot === null ? null : `${FLAGS_DIR}/${flag.taskId}/${flag.turnId}.jpg`
      if (shot !== null) writeFileSync(join(dir, `${flag.turnId}.jpg`), shot)
      const since = taskAt - ASKED_BEFORE_MS

      // The Task's records: every hop's and Step's, by the Task's id; their Misfires; the flags of it before this one.
      const records = linesSince(logsDir, DECISION_FILE_PATTERN, since).filter((line) => line.includes(flag.taskId) || line.includes('"misfire"')).map(parsed)
      const turns = new Set<string>()
      const asks = new Set<string>()
      const kept: Record<string, unknown>[] = []
      for (const record of records) {
        if (record?.type !== 'decision') continue
        const task = record.task as { id?: string } | undefined
        if ((task?.id ?? record.turnId) !== flag.taskId) continue
        kept.push(record)
        turns.add(record.turnId as string)
        if (typeof record.ask === 'string') asks.add(record.ask)
        for (const id of (record.partialAsks as string[] | undefined) ?? []) asks.add(id)
        const split = record.split as { ask?: string } | undefined
        if (typeof split?.ask === 'string') asks.add(split.ask)
      }
      for (const record of records) {
        if (record?.type === 'misfire' && turns.has(record.turnId as string)) kept.push(record)
        if (record?.type === 'flag' && record.taskId === flag.taskId && record.turnId !== flag.turnId) kept.push(record)
      }
      kept.push({ ...flag, ...(shotPath !== null ? { shot: shotPath } : {}) })
      writeFileSync(join(dir, `decision-${flag.taskId}.jsonl`), kept.map((record) => `${JSON.stringify(record)}\n`).join(''))

      // Its asks, and the images they name, at the same paths under the folder.
      const askLines = linesSince(logsDir, ASK_FILE_PATTERN, since).filter((line) => {
        const ask = [...asks].some((id) => line.includes(id)) || [...turns].some((id) => line.includes(id)) ? parsed(line) : null
        return ask !== null && (asks.has(ask.id as string) || turns.has(ask.turnId as string))
      })
      writeFileSync(join(dir, `asks-${flag.taskId}.jsonl`), askLines.map((line) => `${line}\n`).join(''))
      for (const line of askLines) {
        for (const file of Object.values((parsed(line)?.images as Record<string, string> | undefined) ?? {})) {
          const from = join(logsDir, file)
          if (!existsSync(from)) continue
          mkdirSync(dirname(join(dir, file)), { recursive: true })
          copyFileSync(from, join(dir, file))
        }
      }
      return shotPath
    },
  }
}
