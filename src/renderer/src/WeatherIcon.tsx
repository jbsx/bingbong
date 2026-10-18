import type { WeatherSky } from '../../core/weather/weather'

// The idle screen's glyphs: line icons in the Apple restyle's weight (ADR
// 0012), each part in its own system color so the sky reads from across the
// room — sun yellow, cloud grey, rain blue, snow cyan, lightning orange.
// Path data from Lucide (https://lucide.dev), ISC License, Copyright (c)
// 2022 Lucide Contributors; the colouring per part is ours.

// A part with no tone draws in the glyph's own colour (the shell's chrome icons, #334).
export type Part = { d: string; tone?: Tone } | { circle: [number, number, number]; tone?: Tone }
type Tone = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'bolt' | 'sunrise' | 'sunset' | 'ink'

const SUN_RAYS = ['M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41']
const SUN_RAYS_BEHIND = ['M12 2v2', 'm4.93 4.93 1.41 1.41', 'M20 12h2', 'm19.07 4.93-1.41 1.41', 'M15.947 12.65a4 4 0 0 0-5.925-4.128']
const CLOUD = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'
const CLOUD_OPEN = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'
const CLOUD_LOW = 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z'

const sun = (): Part[] => [{ circle: [12, 12, 4], tone: 'sun' }, ...SUN_RAYS.map((d) => ({ d, tone: 'sun' as Tone }))]
const moon = (): Part[] => [{ d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z', tone: 'moon' }]
const cloudSun = (): Part[] => [...SUN_RAYS_BEHIND.map((d) => ({ d, tone: 'sun' as Tone })), { d: CLOUD_LOW, tone: 'cloud' }]
const cloudMoon = (): Part[] => [
  { d: 'M10.188 8.5A6 6 0 0 1 16 4a1 1 0 0 0 6 6 6 6 0 0 1-3 5.197', tone: 'moon' },
  { d: 'M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z', tone: 'cloud' },
]
const cloud = (): Part[] => [{ d: CLOUD, tone: 'cloud' }]
const fog = (): Part[] => [{ d: CLOUD_OPEN, tone: 'cloud' }, { d: 'M16 17H7', tone: 'cloud' }, { d: 'M17 21H9', tone: 'cloud' }]
const drizzle = (): Part[] => [{ d: CLOUD_OPEN, tone: 'cloud' }, ...['M8 19v1', 'M8 14v1', 'M16 19v1', 'M16 14v1', 'M12 21v1', 'M12 16v1'].map((d) => ({ d, tone: 'rain' as Tone }))]
const rain = (): Part[] => [{ d: CLOUD_OPEN, tone: 'cloud' }, ...['M16 14v6', 'M8 14v6', 'M12 16v6'].map((d) => ({ d, tone: 'rain' as Tone }))]
const freezing = (): Part[] => [{ d: CLOUD_OPEN, tone: 'cloud' }, { d: 'M16 14v2', tone: 'rain' }, { d: 'M8 14v2', tone: 'rain' }, { d: 'M12 16v2', tone: 'rain' }, { d: 'M16 20h.01', tone: 'snow' }, { d: 'M8 20h.01', tone: 'snow' }, { d: 'M12 22h.01', tone: 'snow' }]
const snow = (): Part[] => [{ d: CLOUD_OPEN, tone: 'cloud' }, ...['M8 15h.01', 'M8 19h.01', 'M12 17h.01', 'M12 21h.01', 'M16 15h.01', 'M16 19h.01'].map((d) => ({ d, tone: 'snow' as Tone }))]
const showers = (): Part[] => [...SUN_RAYS_BEHIND.map((d) => ({ d, tone: 'sun' as Tone })), { d: 'M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24', tone: 'cloud' }, { d: 'M11 20v2', tone: 'rain' }, { d: 'M7 19v2', tone: 'rain' }]
const thunder = (): Part[] => [{ d: 'M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', tone: 'cloud' }, { d: 'm13 12-3 5h4l-3 5', tone: 'bolt' }]
const unknown = (): Part[] => [{ d: CLOUD, tone: 'cloud' }]

function partsOf(sky: WeatherSky, isDay: boolean | null): Part[] {
  const night = isDay === false
  switch (sky) {
    case 'clear':
      return night ? moon() : sun()
    case 'partly-cloudy':
      return night ? cloudMoon() : cloudSun()
    case 'cloudy':
      return cloud()
    case 'fog':
      return fog()
    case 'drizzle':
      return drizzle()
    case 'rain':
      return rain()
    case 'freezing':
      return freezing()
    case 'snow':
      return snow()
    case 'showers':
      return night ? rain() : showers()
    case 'thunder':
      return thunder()
    case 'unknown':
      return unknown()
  }
}

export function Glyph({
  parts,
  size,
  label,
  strokeWidth = 1.75,
  className = 'wx-icon',
}: {
  parts: Part[]
  size: number
  label?: string
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {parts.map((part, index) =>
        'circle' in part ? (
          <circle key={index} className={part.tone && `wx-${part.tone}`} cx={part.circle[0]} cy={part.circle[1]} r={part.circle[2]} />
        ) : (
          <path key={index} className={part.tone && `wx-${part.tone}`} d={part.d} />
        ),
      )}
    </svg>
  )
}

/** The sky as one glyph; a clear or partly cloudy night draws the moon. */
export function WeatherIcon({ sky, isDay, size, label }: { sky: WeatherSky; isDay: boolean | null; size: number; label?: string }) {
  return <Glyph parts={partsOf(sky, isDay)} size={size} label={label} strokeWidth={size >= 48 ? 1.5 : 1.75} />
}

const SUNRISE: Part[] = [...['M12 2v8', 'm4.93 10.93 1.41 1.41', 'M2 18h2', 'M20 18h2', 'm19.07 10.93-1.41 1.41', 'M16 18a4 4 0 0 0-8 0'].map((d) => ({ d, tone: 'sunrise' as Tone })), { d: 'm8 6 4-4 4 4', tone: 'sunrise' }, { d: 'M22 22H2', tone: 'ink' }]
const SUNSET: Part[] = [...['M12 10V2', 'm4.93 10.93 1.41 1.41', 'M2 18h2', 'M20 18h2', 'm19.07 10.93-1.41 1.41', 'M16 18a4 4 0 0 0-8 0'].map((d) => ({ d, tone: 'sunset' as Tone })), { d: 'm16 6-4 4-4-4', tone: 'sunset' }, { d: 'M22 22H2', tone: 'ink' }]
const DROPLETS: Part[] = [
  { d: 'M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z', tone: 'rain' },
  { d: 'M12.56 14.6A4.19 4.19 0 0 0 11 18a4.19 4.19 0 0 0 4 3.9c2.21 0 4-1.68 4-3.9 0-1.04-.4-2.07-1.14-2.93l-2.86-3.07-2.44 3.6z', tone: 'rain' },
]
const ARROW_UP: Part[] = [{ d: 'M12 19V5', tone: 'ink' }, { d: 'm5 12 7-7 7 7', tone: 'ink' }]
const ARROW_DOWN: Part[] = [{ d: 'M12 5v14', tone: 'ink' }, { d: 'm19 12-7 7-7-7', tone: 'ink' }]
const GLOBE: Part[] = [{ circle: [12, 12, 10], tone: 'ink' }, { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', tone: 'ink' }, { d: 'M2 12h20', tone: 'ink' }]
export const CHEVRON: Part[] = [{ d: 'm9 18 6-6-6-6', tone: 'ink' }]

export function SunriseIcon({ size }: { size: number }) {
  return <Glyph parts={SUNRISE} size={size} label="sunrise" />
}
export function SunsetIcon({ size }: { size: number }) {
  return <Glyph parts={SUNSET} size={size} label="sunset" />
}
export function RainChanceIcon({ size }: { size: number }) {
  return <Glyph parts={DROPLETS} size={size} label="chance of rain" />
}
export function HighIcon({ size }: { size: number }) {
  return <Glyph parts={ARROW_UP} size={size} label="high" strokeWidth={2} />
}
export function LowIcon({ size }: { size: number }) {
  return <Glyph parts={ARROW_DOWN} size={size} label="low" strokeWidth={2} />
}
export function GlobeIcon({ size }: { size: number }) {
  return <Glyph parts={GLOBE} size={size} />
}
export function ChevronIcon({ size }: { size: number }) {
  return <Glyph parts={CHEVRON} size={size} strokeWidth={2} />
}
