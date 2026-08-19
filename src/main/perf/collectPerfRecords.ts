import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PerfSpanRecord } from '../../core/perf/perfTracer'

// The #33 report's file half: every perf-*.jsonl under the logs dir, parsed
// in file-name (creation) order. Malformed lines — a torn final line after a
// crash, a corrupted middle — are skipped and counted, never fatal; a
// missing or unreadable dir is an empty collection. Dir resolution mirrors
// the app: explicit argument, then BINGBONG_USER_DATA_DIR, then the
// platform's default user-data dir. Imports stay type-only beyond node
// builtins so the standalone script can run this file without a bundler;
// the perf-*.jsonl contract with the sink is pinned by a round-trip test.

// Same "perf-*.jsonl" the sink writes (jsonlPerfSink keeps its own copy).
const PERF_FILE_PATTERN = /^perf-.*\.jsonl$/

export interface PerfLogCollection {
  records: PerfSpanRecord[]
  /** Files actually read, in order — the report's context line. */
  filePaths: string[]
  /** Lines that failed to parse or failed the record shape. */
  skippedLines: number
}

/** Accepts a parsed line only when it carries the record contract's core. */
function parseRecord(line: string): PerfSpanRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.turnId !== 'string' || record.turnId === '') return null
  if (typeof record.stage !== 'string' || record.stage === '') return null
  if (typeof record.durMs !== 'number' || !Number.isFinite(record.durMs)) return null
  return parsed as PerfSpanRecord
}

export function collectPerfRecords(logsDir: string): PerfLogCollection {
  const collection: PerfLogCollection = { records: [], filePaths: [], skippedLines: 0 }
  let names: string[]
  try {
    names = readdirSync(logsDir).filter((name) => PERF_FILE_PATTERN.test(name)).sort()
  } catch {
    // Missing or unreadable dir — nothing to aggregate.
    return collection
  }
  for (const name of names) {
    const path = join(logsDir, name)
    let content: string
    try {
      content = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    collection.filePaths.push(path)
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue
      const record = parseRecord(line)
      if (record === null) {
        collection.skippedLines += 1
        continue
      }
      collection.records.push(record)
    }
  }
  return collection
}

function defaultUserDataDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  home: string,
): string {
  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'bingbong')
    case 'win32':
      return join(env.APPDATA?.trim() || home, 'bingbong')
    default:
      return join(env.XDG_CONFIG_HOME?.trim() || join(home, '.config'), 'bingbong')
  }
}

/**
 * Where `pnpm perf:report` reads from: the first argument (a logs dir
 * itself), else `<BINGBONG_USER_DATA_DIR>/logs` (the override the app
 * honors), else the platform default's logs dir.
 */
export function resolvePerfLogsDir(
  args: readonly string[],
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const explicit = args.find((arg) => arg.trim() !== '')
  if (explicit !== undefined) return explicit
  const override = env.BINGBONG_USER_DATA_DIR?.trim()
  if (override) return join(override, 'logs')
  return join(defaultUserDataDir(env, platform, home), 'logs')
}
