#!/usr/bin/env node
// `pnpm logs:pull [machine] [dir]` (#418): copy a machine's folder of the Log
// Bucket (default `kiosk`) to a local folder (default `kiosk-logs/<machine>`),
// then read it with `pnpm perf:report <dir>` and the other logs scripts.
// Needs rclone on this PC and the RCLONE_CONFIG_R2_* lines in the root .env.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planLogsPull } from '../src/main/logs/logsPull.ts'

let dotEnv = ''
try {
  dotEnv = readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8')
} catch {
  // No root .env: the settings can still come from the process environment.
}

const plan = planLogsPull(process.argv.slice(2), dotEnv, process.env)
if ('missing' in plan) {
  console.error(`logs:pull: set ${plan.missing.join(' and ')} in the root .env (see .env.example, "The Log Bucket")`)
  process.exit(1)
}

const result = spawnSync('rclone', plan.argv, { stdio: 'inherit', env: { ...process.env, ...plan.env } })
if (result.error) {
  console.error(`logs:pull: could not run rclone (${result.error.message}); install it: https://rclone.org/install/`)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`logs:pull: ${plan.argv[1]} → ${plan.dir}\n  next: pnpm perf:report ${plan.dir}`)
