// Stand-in Weigh-ins (#350) for the e2e and the Idle Screen shot: two
// months of mornings drifting from about 84 kg to 81.25 kg, the latest this
// morning, every one with the resistances the owner's scale measured, with
// no Person — a file from before #351, so all Jaish's. Barun's (#351) are a
// month of evenings about 72 kg. Seeded as weighins.json in the profile, the
// file the Scale Listener keeps.

const DAY = 24 * 60 * 60 * 1000

export interface SeedWeighIn {
  at: number
  kg: number
  r1: number
  r2: number
  person?: string
}

export function standInWeighIns(now = Date.now(), days = 60): SeedWeighIn[] {
  const morning = new Date(now)
  morning.setHours(7, 12, 0, 0)
  const latest = Math.min(morning.getTime(), now - 60_000)
  return Array.from({ length: days }, (_, index) => {
    const back = days - 1 - index
    // A slow loss with a weekly wobble, to the 0.05 kg the scale reads.
    const kg = 81.25 + back * 0.045 + 0.35 * Math.sin(back / 1.3)
    return { at: latest - back * DAY, kg: back === 0 ? 81.25 : Math.round(kg * 20) / 20, r1: 505 + (back % 9), r2: 500 + (back % 4) }
  })
}

/** Barun's: every other evening of the last month, about 72 kg, the latest last night. */
export function brotherWeighIns(now = Date.now(), days = 30): SeedWeighIn[] {
  const evening = new Date(now - DAY)
  evening.setHours(21, 40, 0, 0)
  return Array.from({ length: Math.ceil(days / 2) }, (_, index) => {
    const back = (Math.ceil(days / 2) - 1 - index) * 2
    return { at: evening.getTime() - back * DAY, kg: Math.round((72.1 - back * 0.02 + 0.3 * Math.cos(back / 2)) * 20) / 20, r1: 470 + (back % 7), r2: 468, person: 'barun' }
  })
}

/** weighins.json as the store writes it. */
export function weighInsFile(weighIns: readonly SeedWeighIn[]): string {
  return `${JSON.stringify({ weighIns }, null, 2)}\n`
}

/** The owner's Body Profile, for the figures — saved as #350's `body`, which #351 gives to Jaish. */
export const OWNER_BODY = { heightCm: 180, birthDate: '1991-03-01', sex: 'male' }

/** The Weight section with Barun's profile too, for a profile seeded with his Weigh-ins. */
export const TWO_PEOPLE = {
  people: [
    { id: 'jaish', name: 'Jaish', body: OWNER_BODY, guess: true },
    { id: 'barun', name: 'Barun', body: { heightCm: 172, birthDate: '1995-07-12', sex: 'male' }, guess: true },
  ],
}
