// Stand-in Weigh-ins (#350) for the e2e and the Idle Screen shot: two
// months of mornings drifting from about 84 kg to 81.25 kg, the latest this
// morning, every one with the resistances the owner's scale measured. Seeded
// as weighins.json in the profile, the file the Scale Listener keeps.

const DAY = 24 * 60 * 60 * 1000

export interface SeedWeighIn {
  at: number
  kg: number
  r1: number
  r2: number
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

/** weighins.json as the store writes it. */
export function weighInsFile(weighIns: readonly SeedWeighIn[]): string {
  return `${JSON.stringify({ weighIns }, null, 2)}\n`
}

/** The owner's Body Profile, for the figures. */
export const OWNER_BODY = { heightCm: 180, birthDate: '1991-03-01', sex: 'male' }
