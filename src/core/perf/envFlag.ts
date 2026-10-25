// The established BINGBONG_* opt-in convention (#32/#34): a flag counts as
// on for 1/true/yes/on, case- and whitespace-insensitive; everything else
// (unset included) is off. One parser so the opt-in flags cannot drift.

export function envFlagEnabled(env: Record<string, string | undefined>, name: string): boolean {
  const value = env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

/** The opt-out side (kiosk telemetry 2026-10-25): a flag counts as off only for 0/false/no/off; unset and anything else leave it on. */
export function envFlagDisabled(env: Record<string, string | undefined>, name: string): boolean {
  const value = env[name]?.trim().toLowerCase()
  return value === '0' || value === 'false' || value === 'no' || value === 'off'
}
