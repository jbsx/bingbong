import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { reportFault } from '../../core/trace/fault.ts'
import type { TaggedTraceRecord, TraceFamily, TraceLine } from '../../core/trace/traceTimeline.ts'
import { resolvePerfLogsDir } from '../perf/collectPerfRecords.ts'
import { traceFamilyOf } from './traceFiles.ts'

// The Trace UI's file half (#189): a tail over every perf-*.jsonl,
// run-trace-*.jsonl and host-trace-*.jsonl under one logs dir. The app's
// shared sink appends one JSON line per record, rolls to a new file at
// ~5 MB and purges a family's files after seven days, so a reader that is
// left open has to see appended bytes, a file that appeared and a file
// that went away — and it has to do so without re-reading every file on
// every write, because a Run's `pipeline_event` records arrive one per
// event. Each file keeps a byte offset and its parsed records; a poll
// reads only what is new. A torn last line — the sink mid-write, or an
// app that crashed — is held back as bytes (never as a decoded string, so
// a multibyte character split by the read is not corrupted) until its
// newline arrives. A line that is not a record is skipped and counted,
// never fatal, exactly as `pnpm perf:report` treats one.
//
// Every runtime import carries a .ts extension (#36): this file runs
// unbundled under node's type stripping, and jsonlSink's extensionless
// imports are why the family patterns live in traceFiles rather than
// beside each sink.

export interface TraceLogCollection {
  /** Every record currently on disk, grouped by file in file-name order. */
  readonly records: readonly TaggedTraceRecord[]
  /** The files the collection was read from, in that order. */
  readonly filePaths: readonly string[]
  /** Lines that failed to parse or carried no `at`, across every file. */
  readonly skippedLines: number
}

export interface TraceTail {
  /** Reads whatever changed since the last poll and answers the whole collection. */
  poll(): TraceLogCollection
}

interface TailedFile {
  readonly family: TraceFamily
  offset: number
  pending: Buffer
  records: TaggedTraceRecord[]
  skipped: number
}

/** Accepts a parsed line only when it carries the one field every family shares. */
function parseLine(line: string): TraceLine | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    reportFault('trace.collectTraceRecords.parseLine', error)
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null
  return record as TraceLine
}

function readFrom(path: string, offset: number, length: number): Buffer | null {
  const buffer = Buffer.alloc(length)
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    let read = 0
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, offset + read)
      if (n === 0) break
      read += n
    }
    return read === length ? buffer : buffer.subarray(0, read)
  } catch (error) {
    reportFault('trace.collectTraceRecords.readFrom', error)
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export function createTraceTail(logsDir: string): TraceTail {
  const files = new Map<string, TailedFile>()

  function consume(file: TailedFile, tagged: (record: TraceLine) => TaggedTraceRecord): void {
    const newline = file.pending.lastIndexOf(0x0a)
    if (newline === -1) return
    const complete = file.pending.subarray(0, newline).toString('utf8')
    file.pending = Buffer.from(file.pending.subarray(newline + 1))
    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue
      const record = parseLine(line)
      if (record === null) {
        file.skipped += 1
        continue
      }
      file.records.push(tagged(record))
    }
  }

  function refresh(name: string, family: TraceFamily): void {
    const path = join(logsDir, name)
    let size: number
    try {
      size = statSync(path).size
    } catch (error) {
      reportFault('trace.collectTraceRecords.stat', error)
      files.delete(name)
      return
    }
    let file = files.get(name)
    if (file === undefined || size < file.offset) {
      // New, or truncated underneath us: read it whole again.
      file = { family, offset: 0, pending: Buffer.alloc(0), records: [], skipped: 0 }
      files.set(name, file)
    }
    if (size === file.offset) return
    const chunk = readFrom(path, file.offset, size - file.offset)
    if (chunk === null) return
    file.offset += chunk.length
    file.pending = Buffer.concat([file.pending, chunk])
    consume(file, (record) => ({ family, record }))
  }

  return {
    poll() {
      let names: string[]
      try {
        names = readdirSync(logsDir)
      } catch (error) {
        reportFault('trace.collectTraceRecords.listFiles', error)
        // Missing or unreadable dir — nothing has been written, which is an answer.
        files.clear()
        return { records: [], filePaths: [], skippedLines: 0 }
      }
      const present = new Set<string>()
      for (const name of names.sort()) {
        const family = traceFamilyOf(name)
        if (family === null) continue
        present.add(name)
        refresh(name, family)
      }
      for (const name of [...files.keys()]) {
        if (!present.has(name)) files.delete(name)
      }
      const records: TaggedTraceRecord[] = []
      const filePaths: string[] = []
      let skippedLines = 0
      for (const name of [...files.keys()].sort()) {
        const file = files.get(name) as TailedFile
        filePaths.push(join(logsDir, name))
        records.push(...file.records)
        skippedLines += file.skipped
      }
      return { records, filePaths, skippedLines }
    },
  }
}

/** One read of everything on disk — the tail's first poll, for callers that never tail. */
export function collectTraceRecords(logsDir: string): TraceLogCollection {
  return createTraceTail(logsDir).poll()
}

/** The flags `pnpm trace:ui` takes; each value flag consumes the argument after it. */
const VALUE_FLAGS = new Set(['--port'])

/**
 * Where `pnpm trace:ui` reads from: the first non-flag argument (a logs
 * dir itself), else the same resolution `pnpm perf:report` uses —
 * `<BINGBONG_USER_DATA_DIR>/logs`, else the platform default's logs dir.
 */
export function resolveTraceLogsDir(
  args: readonly string[],
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const positional: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (VALUE_FLAGS.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('--')) continue
    positional.push(arg)
  }
  return resolvePerfLogsDir(positional, env, platform, home)
}
