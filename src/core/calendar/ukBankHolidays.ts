/** A public holiday on a local calendar day, as `YYYY-MM-DD`. */
export interface Holiday {
  readonly date: string
  readonly title: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function weekday(ms: number): number {
  return new Date(ms).getUTCDay()
}

/** Easter Sunday (the anonymous Gregorian computus), as UTC midnight. */
function easterSunday(year: number): number {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(year, month - 1, day)
}

function firstMonday(year: number, month: number): number {
  const first = Date.UTC(year, month, 1)
  return first + ((8 - weekday(first)) % 7) * DAY_MS
}

function lastMonday(year: number, month: number): number {
  const last = Date.UTC(year, month + 1, 0)
  return last - ((weekday(last) + 6) % 7) * DAY_MS
}

/** A holiday falling on a weekend is taken the Monday after. */
function substitute(ms: number): number {
  const day = weekday(ms)
  return day === 6 ? ms + 2 * DAY_MS : day === 0 ? ms + DAY_MS : ms
}

/**
 * Proclaimed changes the rules cannot know: a regular holiday moved
 * (keyed by the date the rules give) and one-off holidays added. From
 * gov.uk/bank-holidays.json; a new proclamation is added here.
 */
const MOVED: Readonly<Record<string, Holiday>> = {
  '2020-05-04': { date: '2020-05-08', title: 'Early May bank holiday (VE day)' },
  '2022-05-30': { date: '2022-06-02', title: 'Spring bank holiday' },
}
const ADDED: readonly Holiday[] = [
  { date: '2022-06-03', title: 'Platinum Jubilee bank holiday' },
  { date: '2022-09-19', title: 'Bank Holiday for the State Funeral of Queen Elizabeth II' },
  { date: '2023-05-08', title: 'Bank holiday for the coronation of King Charles III' },
]

/**
 * England and Wales's bank holidays in `year`, by date, titled as gov.uk
 * titles them. Christmas and Boxing Day on a weekend move to the next
 * working days, Boxing Day keeping the Monday when Christmas is a Sunday.
 */
export function ukBankHolidays(year: number): Holiday[] {
  const easter = easterSunday(year)
  const christmas = Date.UTC(year, 11, 25)
  const christmasDay = weekday(christmas)
  const boxing = christmas + DAY_MS
  const [christmasOff, boxingOff] =
    christmasDay === 6
      ? [christmas + 2 * DAY_MS, christmas + 3 * DAY_MS]
      : christmasDay === 0
        ? [christmas + 2 * DAY_MS, boxing]
        : christmasDay === 5
          ? [christmas, christmas + 3 * DAY_MS]
          : [christmas, boxing]
  const ruled: Holiday[] = [
    { date: isoDate(substitute(Date.UTC(year, 0, 1))), title: 'New Year’s Day' },
    { date: isoDate(easter - 2 * DAY_MS), title: 'Good Friday' },
    { date: isoDate(easter + DAY_MS), title: 'Easter Monday' },
    { date: isoDate(firstMonday(year, 4)), title: 'Early May bank holiday' },
    { date: isoDate(lastMonday(year, 4)), title: 'Spring bank holiday' },
    { date: isoDate(lastMonday(year, 7)), title: 'Summer bank holiday' },
    { date: isoDate(christmasOff), title: 'Christmas Day' },
    { date: isoDate(boxingOff), title: 'Boxing Day' },
  ]
  const added = ADDED.filter((holiday) => holiday.date.startsWith(`${year}-`))
  return [...ruled.map((holiday) => MOVED[holiday.date] ?? holiday), ...added].sort((a, b) => a.date.localeCompare(b.date))
}

/** The local calendar day of `ms` as `YYYY-MM-DD`, the key a Holiday is dated by. */
export function localDateKey(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The first holiday on or after `now`'s day, or null when none is listed. */
export function nextHoliday(now: Date, holidays: readonly Holiday[]): Holiday | null {
  const today = localDateKey(now.getTime())
  return holidays.find((holiday) => holiday.date >= today) ?? null
}
