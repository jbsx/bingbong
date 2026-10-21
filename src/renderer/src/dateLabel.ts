/**
 * A date as the locale writes it (`toLocaleString` with these options), but
 * with every short month three letters: en-GB gives September four, "Sept",
 * and a row of "Sept" sat wider than the "Aug" beside it.
 */
export function dateLabel(at: Date | number, options: Intl.DateTimeFormatOptions, locales?: Intl.LocalesArgument): string {
  return new Intl.DateTimeFormat(locales, options)
    .formatToParts(at)
    .map((part) => (part.type === 'month' && part.value === 'Sept' ? 'Sep' : part.value))
    .join('')
}
