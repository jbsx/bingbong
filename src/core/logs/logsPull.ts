import { parseDotEnv } from '../settings/dotEnv.ts'
import { logBucketSettings, type LogBucketSettings } from './logBucket.ts'

// `pnpm logs:pull [machine] [dir]` (#418): copy one machine's folder of the
// Log Bucket to a local folder, which perf:report, jev:candidates and the
// bugs scripts then read as any logs dir. The bucket's settings come from
// the root .env, the same BINGBONG_LOG_BUCKET* lines the kiosk's app reads;
// the process environment wins, as it does for the app.

export type LogsPullPlan = { settings: LogBucketSettings; machine: string; dir: string } | { missing: string[] }

export function planLogsPull(
  args: readonly string[],
  dotEnvText: string,
  processEnv: Record<string, string | undefined>,
): LogsPullPlan {
  const settings = logBucketSettings({ ...parseDotEnv(dotEnvText), ...processEnv })
  if ('missing' in settings) return settings
  const machine = args[0]?.trim() || 'kiosk'
  const dir = args[1]?.trim() || `kiosk-logs/${machine}`
  return { settings, machine, dir }
}
