import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveLogsDir, redactedMessage } from '../live/artifacts.ts'
import type { LiveArtifactFamily } from '../live/types.ts'

// Eval trace retention (#280): an eval capture already writes a Run Trace
// (the harness sets BINGBONG_RUN_TRACE on every launch), and lost it only
// because quit() deletes the temp profile. So retention is a copy before a
// delete, through the live archiver — the allowlisted diagnostic families,
// redacted, a digest and byte count per file, a torn tail dropped and
// flagged — into a directory the Shadow Replay reads as it reads a live
// capture: `<root>/<set>-<pass>--<name>/logs/run-trace-*.jsonl`.
//
// The traces live under their own git-ignored root, never beside the pass
// reports: the pool readers take every top-level `*.json` in a pool
// directory, so anything extra there would break eval:accept and
// eval:compare. What is committed is the replay's report.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Where eval reports live; a report's traces mirror its path below this. */
export const EVAL_REPORTS_ROOT = join(repoRoot, 'e2e', 'eval')
/** Where eval traces live: ignored by Git. */
export const EVAL_TRACES_ROOT = join(EVAL_REPORTS_ROOT, 'traces')

export interface TraceRoots {
  readonly reportsRoot: string
  readonly tracesRoot: string
}

/** A pass report named for its commit: `pass-1-afbd1fe3`. */
const COMMIT_SUFFIX = /^(.+)-([0-9a-f]{8})$/

function inside(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset !== '' && !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`)
}

/**
 * The directory a report's traces are kept in: its path under the reports
 * root, mirrored under the traces root, with the report's name as the
 * replay names a capture — `<set>-<pass>--<commit8>`. So
 * `jev/on/pass-1-afbd1fe3.json` keeps its traces in
 * `traces/jev/on/pass-1--afbd1fe3/`, which `decision:shadow
 * --roots=e2e/eval/traces/jev/on --sets=pass` reads with no change. A
 * report named without a commit (the delegation probe's `pass-<n>.json`)
 * takes the commit it was captured on.
 */
export function traceDirFor(reportPath: string, commit: string, roots: TraceRoots = { reportsRoot: EVAL_REPORTS_ROOT, tracesRoot: EVAL_TRACES_ROOT }): string {
  if (!inside(roots.reportsRoot, reportPath)) {
    throw new Error(`an eval report must live under ${roots.reportsRoot} for its traces to mirror its path — got ${reportPath}`)
  }
  if (inside(roots.tracesRoot, reportPath)) {
    throw new Error(`an eval report may not live inside the traces root ${roots.tracesRoot} — got ${reportPath}`)
  }
  const stem = basename(reportPath).replace(/\.json$/, '')
  const named = COMMIT_SUFFIX.exec(stem)
  const name = named === null ? `${stem}--${commit.slice(0, 8)}` : `${named[1]}--${named[2]}`
  return join(roots.tracesRoot, relative(roots.reportsRoot, dirname(reportPath)), name)
}

/** One retained file, as the report names it. */
export interface RetainedTraceFile {
  readonly name: string
  readonly family: LiveArtifactFamily
  readonly bytes: number
  readonly digest: string
  /** False when the archiver dropped a torn tail or a malformed line. */
  readonly complete: boolean
  readonly note?: string
}

/**
 * A report's `traces` field (#280): where its Run Trace was kept and what
 * was kept. It sits at the report's top level, never inside `routing`,
 * which eval:accept compares canonically across a pool's passes. A failed
 * archive is recorded here and never fails the capture: the pass's
 * measurements stand without it.
 */
export interface RetainedTraces {
  /** The trace directory, relative to the repository root. */
  readonly directory: string
  /** True only for a finished pass whose every file was copied whole. */
  readonly complete: boolean
  readonly files: readonly RetainedTraceFile[]
  /** Files the archiver could not copy, with a redacted reason each. */
  readonly failures: readonly { readonly name: string; readonly reason: string }[]
  /** Why nothing could be archived at all, redacted. */
  readonly error?: string
  readonly note?: string
}

const UNFINISHED_NOTE = 'the pass did not finish: these are the traces it wrote before it stopped'

/**
 * Copy a profile's logs family into `traceDir/logs/`. Never throws: a
 * failure is returned in the record. `finished` is false for the copy
 * quit() makes of a pass that died before finish(), which is flagged
 * incomplete whatever its files say.
 */
export function retainTraces(
  logsDir: string,
  traceDir: string,
  options: { readonly secrets?: readonly string[]; readonly finished: boolean; readonly relativeTo?: string },
): RetainedTraces {
  const directory = relative(options.relativeTo ?? repoRoot, traceDir)
  const unfinished = options.finished ? {} : { note: UNFINISHED_NOTE }
  try {
    const archived = archiveLogsDir(logsDir, traceDir, { secrets: options.secrets })
    const files = archived.artifacts.map((artifact) => ({
      name: artifact.locator ?? basename(artifact.path),
      family: artifact.family,
      bytes: artifact.bytes,
      digest: artifact.digest,
      complete: artifact.complete,
      ...(artifact.note !== undefined ? { note: artifact.note } : {}),
    }))
    return {
      directory,
      complete: options.finished && archived.failures.length === 0 && files.every((file) => file.complete),
      files,
      failures: archived.failures,
      ...unfinished,
    }
  } catch (error) {
    return { directory, complete: false, files: [], failures: [], error: redactedMessage(error, options.secrets), ...unfinished }
  }
}

/** Env keys whose values are credentials, stripped from every retained line. */
const SECRET_KEY_PATTERN = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/

/** The credential values of a composed env, for {@link retainTraces}. */
export function secretsOf(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.length >= 6)
    .map(([, value]) => value as string)
}
