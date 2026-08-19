// The established BINGBONG_* opt-in convention (#32/#34): a flag counts as
// on for 1/true/yes/on, case- and whitespace-insensitive; everything else
// (unset included) is off. One parser so the opt-in flags cannot drift.

export function envFlagEnabled(env: Record<string, string | undefined>, name: string): boolean {
  const value = env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}
