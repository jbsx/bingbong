// The cities the Settings dropdown offers for the weather. Empty is
// Automatic: the network's own place, London until it is known (weather.ts).

/** The dropdown's cities, alphabetical; each name is one Open-Meteo's geocoder resolves to the city meant. */
export const WEATHER_CITIES: readonly string[] = [
  'Amsterdam', 'Athens', 'Auckland', 'Bangkok', 'Barcelona', 'Beijing', 'Belfast', 'Bengaluru', 'Berlin', 'Birmingham',
  'Boston', 'Brighton', 'Bristol', 'Brussels', 'Buenos Aires', 'Cairo', 'Cambridge', 'Cape Town', 'Cardiff', 'Chennai',
  'Chicago', 'Copenhagen', 'Delhi', 'Dubai', 'Dublin', 'Edinburgh', 'Glasgow', 'Gurgaon', 'Hong Kong', 'Hyderabad',
  'Istanbul', 'Jakarta', 'Johannesburg', 'Kolkata', 'Lagos', 'Leeds', 'Lisbon', 'Liverpool', 'London', 'Los Angeles',
  'Madrid', 'Manchester', 'Melbourne', 'Mexico City', 'Milan', 'Montreal', 'Mumbai', 'Nairobi', 'New York', 'Newcastle',
  'Nottingham', 'Oslo', 'Oxford', 'Paris', 'Prague', 'Pune', 'Rome', 'San Francisco', 'São Paulo', 'Seattle',
  'Seoul', 'Shanghai', 'Sheffield', 'Singapore', 'Stockholm', 'Sydney', 'Tokyo', 'Toronto', 'Vancouver', 'Vienna',
  'Warsaw', 'Washington', 'Zurich',
]

/**
 * What the dropdown lists for a saved `city`: Automatic (empty) first, then
 * the cities, with a saved city the list lacks (typed before the dropdown)
 * slotted in alphabetically so it stays chosen.
 */
export function weatherCityOptions(city: string): string[] {
  const saved = city.trim()
  const known = saved === '' || WEATHER_CITIES.some((name) => name.toLowerCase() === saved.toLowerCase())
  const cities = known ? [...WEATHER_CITIES] : [...WEATHER_CITIES, saved].sort((a, b) => a.localeCompare(b))
  return ['', ...cities]
}
