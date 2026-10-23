import { useEffect, useId, useRef, useState } from 'react'
import { searchPlaces, type PlaceSuggestion } from '../../core/weather/weather'

/** The weather's city as settings keep it: '' is Automatic; a picked city keeps its coordinates. */
export interface WeatherCity {
  city: string
  latitude?: number
  longitude?: number
}

type Search =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; places: PlaceSuggestion[] }
  | { status: 'failed' }

/** How long typing rests before the geocoder is asked. */
const SEARCH_DEBOUNCE_MS = 200

const AUTOMATIC_LABEL = 'Automatic (London until online)'

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`place search failed (${response.status})`)
  return response.json() as Promise<unknown>
}

/**
 * The weather city as a search box: typing asks Open-Meteo's geocoder and
 * lists the places it offers, Automatic always first. Only a picked entry
 * changes the setting; leaving the box puts the saved city back.
 */
export function WeatherCityPicker({ value, onPick }: { value: WeatherCity; onPick: (next: WeatherCity) => void }) {
  const listId = useId()
  const [query, setQuery] = useState(value.city)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState<Search>({ status: 'idle' })
  const [active, setActive] = useState(0)
  const asked = useRef(0)

  useEffect(() => {
    if (!open) setQuery(value.city)
  }, [value.city, open])

  useEffect(() => {
    const words = query.trim()
    if (!open || words.length < 2 || words === value.city) {
      setSearch({ status: 'idle' })
      return
    }
    setSearch({ status: 'searching' })
    const ask = ++asked.current
    const timer = setTimeout(() => {
      searchPlaces(fetchJson, words).then(
        (places) => {
          if (ask === asked.current) setSearch({ status: 'done', places })
        },
        () => {
          if (ask === asked.current) setSearch({ status: 'failed' })
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, open, value.city])

  const places = search.status === 'done' ? search.places : []
  // Automatic leads; with places found, the first of them is the one Enter takes.
  const count = 1 + places.length

  useEffect(() => {
    setActive(places.length > 0 ? 1 : 0)
  }, [search])

  const pick = (index: number) => {
    const place = places[index - 1]
    const next: WeatherCity = place === undefined ? { city: '' } : { city: place.name, latitude: place.latitude, longitude: place.longitude }
    onPick(next)
    setQuery(next.city)
    setOpen(false)
  }

  const close = () => {
    setOpen(false)
    setQuery(value.city)
  }

  const note =
    search.status === 'searching' ? 'Searching…' : search.status === 'failed' ? 'Search unavailable offline' : search.status === 'done' && places.length === 0 ? 'No places match' : null

  return (
    <div className="city-picker">
      <input
        type="text"
        role="combobox"
        aria-label="Weather city"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        placeholder={AUTOMATIC_LABEL}
        value={query}
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => {
          event.currentTarget.select()
          setOpen(true)
        }}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
          } else if (event.key === 'Enter' && open) {
            event.preventDefault()
            pick(active)
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
      />
      {open ? (
        <ul className="city-picker-list" id={listId} role="listbox" aria-label="Weather city suggestions">
          {[null, ...places].map((place, index) => (
            <li
              key={place === null ? 'automatic' : `${place.latitude},${place.longitude}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="city-picker-option"
              onMouseDown={(event) => {
                event.preventDefault()
                pick(index)
              }}
              onMouseEnter={() => setActive(index)}
            >
              {place === null ? (
                <span className="city-picker-name">{AUTOMATIC_LABEL}</span>
              ) : (
                <>
                  <span className="city-picker-name">{place.name}</span>
                  {place.where !== '' ? <span className="city-picker-where">{place.where}</span> : null}
                </>
              )}
            </li>
          ))}
          {note !== null ? <li className="city-picker-note" role="presentation">{note}</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
