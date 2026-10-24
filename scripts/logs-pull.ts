#!/usr/bin/env node
// `pnpm logs:pull [machine] [dir]` (#418): copy a machine's folder of the Log
// Bucket (default `kiosk`) to a local folder (default `kiosk-logs/<machine>`),
// then read it with `pnpm perf:report <dir>` and the other logs scripts.
// Needs only the BINGBONG_LOG_BUCKET* lines in the root .env.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planLogsPull } from '../src/core/logs/logsPull.ts'
import { pullLogs } from '../src/main/logs/pullLogs.ts'
import { createS3Client } from '../src/main/logs/s3Client.ts'

let dotEnv = ''
try {
  dotEnv = readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8')
} catch (error) {
  // No root .env: the settings can still come from the process environment.
  // A present-but-unreadable one is said, never silently skipped.
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.error(`logs:pull: could not read the root .env: ${String(error)}`)
    process.exit(1)
  }
}

const plan = planLogsPull(process.argv.slice(2), dotEnv, process.env)
if ('missing' in plan) {
  console.error(`logs:pull: set ${plan.missing.join(', ')} in the root .env (see .env.example, "The Log Bucket")`)
  process.exit(1)
}

const { settings, machine, dir } = plan
const client = createS3Client(settings)
const { pulled, kept } = await pullLogs(client, machine, dir)
console.log(`logs:pull: ${settings.bucket}/${machine}/ → ${dir} (${pulled} pulled, ${kept} already there)`)
console.log(`  next: pnpm perf:report ${dir}`)
