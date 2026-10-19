import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sanitizeWeighIns, type WeighIn } from '../../core/scale/weighIns'
import { reportFault } from '../../core/trace/fault'

// The Weigh-ins' persistence: weighins.json in userData, beside news.json.
// Raw readings and whose they are (time, kg, r1, r2, Person); the figures
// are worked out on every read. A missing or corrupt file is no Weigh-ins
// yet; a file from before #351 is all Jaish's.

export interface WeighInStore {
  /** Oldest first. */
  list(): WeighIn[]
  add(weighIn: WeighIn): WeighIn[]
  /** Removes the Weigh-in at that time. */
  remove(at: number): WeighIn[]
  /** Gives the Weigh-in at that time to another Person (a wrong guess fixed). */
  move(at: number, person: string): WeighIn[]
  /** Deletes every Weigh-in of a Person being removed. */
  removePerson(person: string): WeighIn[]
}

export function createWeighInStore(path: string): WeighInStore {
  const load = (): WeighIn[] => {
    try {
      return sanitizeWeighIns(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') reportFault('scale.weighInStore.load', error)
      return []
    }
  }
  let weighIns = load()
  const save = (next: WeighIn[]): WeighIn[] => {
    weighIns = sanitizeWeighIns({ weighIns: next })
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify({ weighIns }, null, 2)}\n`, 'utf8')
    } catch (error) {
      reportFault('scale.weighInStore.save', error)
    }
    return weighIns
  }
  return {
    list: () => weighIns,
    add: (weighIn) => save([...weighIns, weighIn]),
    remove: (at) => save(weighIns.filter((weighIn) => weighIn.at !== at)),
    move: (at, person) => save(weighIns.map((weighIn) => (weighIn.at === at ? { ...weighIn, person } : weighIn))),
    removePerson: (person) => save(weighIns.filter((weighIn) => weighIn.person !== person)),
  }
}
