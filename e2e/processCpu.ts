import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'

// Per-process (and per-thread) CPU for the opt-in constrained runs
// (idleCpu, earCapture): jiffies from /proc over a fixed window, as % of one core.

const USER_HZ = 100

/** The app's processes, as every Electron process under this test's own: Chromium's sandboxed children hide their environ. */
export function appProcesses(): Map<number, string> {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => {
      const [, pid, ppid, args] = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)!
      return { pid: Number(pid), ppid: Number(ppid), args }
    })
  const ours = new Set([process.pid])
  for (let grew = true; grew; ) {
    grew = false
    for (const row of rows)
      if (ours.has(row.ppid) && !ours.has(row.pid)) {
        ours.add(row.pid)
        grew = true
      }
  }
  const processes = new Map<number, string>()
  for (const row of rows) {
    if (!ours.has(row.pid) || !row.args.includes('electron')) continue
    const type = row.args.match(/--type=(\S+)/)?.[1] ?? 'browser'
    const sub = row.args.match(/--utility-sub-type=(\S+)/)?.[1]
    processes.set(row.pid, sub ? `${type}:${sub}` : type)
  }
  return processes
}

async function statTicks(path: string): Promise<{ comm: string; ticks: number } | null> {
  const stat = await readFile(path, 'utf8').catch(() => '')
  if (stat === '') return null
  const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'))
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return { comm, ticks: Number(fields[11]) + Number(fields[12]) }
}

export async function cpuTicks(pid: number): Promise<number> {
  return (await statTicks(`/proc/${pid}/stat`))?.ticks ?? 0
}

/** Ticks per thread of one process, keyed `comm#tid`. */
export async function threadTicks(pid: number): Promise<Map<string, number>> {
  const tids = await readdir(`/proc/${pid}/task`).catch(() => [] as string[])
  const threads = new Map<string, number>()
  for (const tid of tids) {
    const stat = await statTicks(`/proc/${pid}/task/${tid}/stat`)
    if (stat) threads.set(`${stat.comm}#${tid}`, stat.ticks)
  }
  return threads
}

/** Ticks over a window of seconds as % of one core, one decimal. */
export const percentOfCore = (ticks: number, seconds: number): number => Math.round((ticks / USER_HZ / seconds) * 1000) / 10
