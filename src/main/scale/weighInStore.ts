import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { toHex } from '../../core/scale/qn'
import { applyEvent, eventLine, parseLog, WEIGH_IN_LOG_VERSION, type WeighInEvent } from '../../core/scale/weighInLog'
import { sanitizeWeighIns, type WeighIn } from '../../core/scale/weighIns'
import { reportFault } from '../../core/trace/fault'

// The Weigh-ins' persistence, in userData beside news.json:
//
// - weighin-events.jsonl, the Weigh-in Log (core/scale/weighInLog): one line
//   appended per change, never rewritten. It is the record.
// - weighins.json, the Weigh-ins the log replays to, rewritten whole on each
//   change through a temporary file and a rename, so a crash mid-write
//   leaves the old file or the new one, never half of one.
//
// On load the log wins. With no log yet (a kiosk from before the log), every Weigh-in
// in weighins.json is written to a new log as a seeded add. An unreadable
// weighins.json beside a good log is rebuilt from it, so a corrupt file can
// no longer start the history afresh. Raw readings and whose they are
// (time, kg, r1, r2, Person); the figures are worked out on every read. A
// file from before #351 is all Jaish's.

export const WEIGH_IN_LOG_FILE = 'weighin-events.jsonl'

export interface WeighInStore {
  /** Oldest first. */
  list(): WeighIn[]
  /** Records a Weigh-in; `frame` is the scale's stable reading frame it was read from, kept raw in the log. */
  add(weighIn: WeighIn, frame?: Uint8Array): WeighIn[]
  /** Removes the Weigh-in at that time. */
  remove(at: number): WeighIn[]
  /** Gives the Weigh-in at that time to another Person (a wrong guess fixed). */
  move(at: number, person: string): WeighIn[]
  /** Deletes every Weigh-in of a Person being removed. */
  removePerson(person: string): WeighIn[]
}

function readText(path: string, faultSite: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault(faultSite, error)
    return null
  }
}

function snapshotText(weighIns: readonly WeighIn[]): string {
  return `${JSON.stringify({ weighIns }, null, 2)}\n`
}

export function createWeighInStore(path: string, logPath: string = join(dirname(path), WEIGH_IN_LOG_FILE), now: () => number = Date.now): WeighInStore {
  const logText = readText(logPath, 'scale.weighInLog.load')
  // A last line cut short has no newline; the next line starts on its own.
  let logTorn = logText !== null && logText !== '' && !logText.endsWith('\n')

  const append = (events: readonly WeighInEvent[]): void => {
    if (events.length === 0) return
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `${logTorn ? '\n' : ''}${events.map(eventLine).join('')}`, 'utf8')
      logTorn = false
    } catch (error) {
      reportFault('scale.weighInLog.append', error)
    }
  }

  const snapshotRaw = readText(path, 'scale.weighInStore.load')
  const writeSnapshot = (next: readonly WeighIn[]): void => {
    const tmp = `${path}.tmp`
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmp, snapshotText(next), 'utf8')
      renameSync(tmp, path)
    } catch (error) {
      reportFault('scale.weighInStore.save', error)
    }
  }

  let weighIns: WeighIn[]
  const { events, skipped } = parseLog(logText ?? '')
  if (skipped > 0) reportFault('scale.weighInLog.skipped', new Error(`${skipped} unreadable line(s) in ${logPath}`))
  if (events.length > 0) {
    weighIns = events.reduce<WeighIn[]>(applyEvent, [])
  } else {
    let fromSnapshot: WeighIn[] = []
    try {
      fromSnapshot = snapshotRaw === null ? [] : sanitizeWeighIns(JSON.parse(snapshotRaw))
    } catch (error) {
      reportFault('scale.weighInStore.load', error)
    }
    const t = fromSnapshot.length > 0 ? now() : 0
    append(fromSnapshot.map((weighIn): WeighInEvent => ({ v: WEIGH_IN_LOG_VERSION, t, op: 'add', weighIn, seeded: true })))
    weighIns = fromSnapshot
  }
  if (snapshotRaw !== snapshotText(weighIns) && (snapshotRaw !== null || weighIns.length > 0)) writeSnapshot(weighIns)

  const record = (event: WeighInEvent): WeighIn[] => {
    append([event])
    weighIns = applyEvent(weighIns, event)
    writeSnapshot(weighIns)
    return weighIns
  }
  const held = (at: number): WeighIn | undefined => weighIns.find((weighIn) => weighIn.at === at)

  return {
    list: () => weighIns,
    add: (weighIn, frame) => {
      const [clean] = sanitizeWeighIns({ weighIns: [weighIn] })
      if (clean === undefined || held(clean.at) !== undefined) return weighIns
      return record({ v: WEIGH_IN_LOG_VERSION, t: now(), op: 'add', weighIn: clean, ...(frame !== undefined ? { frame: toHex(frame) } : {}) })
    },
    remove: (at) => (held(at) === undefined ? weighIns : record({ v: WEIGH_IN_LOG_VERSION, t: now(), op: 'remove', at })),
    move: (at, person) => {
      const from = held(at)?.person
      return from === undefined || from === person ? weighIns : record({ v: WEIGH_IN_LOG_VERSION, t: now(), op: 'move', at, from, to: person })
    },
    removePerson: (person) =>
      weighIns.some((weighIn) => weighIn.person === person) ? record({ v: WEIGH_IN_LOG_VERSION, t: now(), op: 'removePerson', person }) : weighIns,
  }
}
