import { describe, expect, it } from 'vitest'
import {
  EMPTY_REMEMBERED_SONGS,
  forgetVideo,
  forgetWords,
  recallSong,
  rememberSong,
  sanitizeRememberedSongs,
  songTerms,
  stayed,
  trimSongTitle,
} from './rememberedSongs'

// Remembered Songs (#345, ADR 0077 amendment): a pick that stayed is a
// name that worked — the Slot's words point at its video from then on,
// and its title is learned.

const a = { id: 'aaaaaaaaaaa', title: 'Song A' }
const b = { id: 'bbbbbbbbbbb', title: 'Song B' }

describe('Remembered Songs', () => {
  it('a song is recalled by its Slot as the Name Match normalizes it', () => {
    const songs = rememberSong(EMPTY_REMEMBERED_SONGS, 'Bohemian Rhapsody', a, 1)
    expect(recallSong(songs, "bohemian  rhapsody.")).toEqual(a)
    expect(recallSong(songs, 'bohemian')).toBeNull()
  })

  it('one video per Slot: the latest stay wins', () => {
    const songs = rememberSong(rememberSong(EMPTY_REMEMBERED_SONGS, 'song', a, 1), 'Song', b, 2)
    expect(recallSong(songs, 'song')).toEqual(b)
    expect(songs.songs).toHaveLength(1)
  })

  it('forgets by its words, or every Slot that points at a video', () => {
    const songs = rememberSong(rememberSong(rememberSong(EMPTY_REMEMBERED_SONGS, 'song a', a, 1), 'the a song', a, 2), 'song b', b, 3)
    expect(recallSong(forgetWords(songs, 'Song A'), 'song a')).toBeNull()
    const forgot = forgetVideo(songs, a.id)
    expect(forgot.forgot).toBe(true)
    expect(forgot.songs.songs.map((song) => song.words)).toEqual(['song b'])
    expect(forgetVideo(forgot.songs, a.id).forgot).toBe(false)
  })

  it('a corrupt file reads as the songs it can vouch for', () => {
    const raw = { songs: [{ words: 'song a', id: a.id, title: 'Song A', at: 1 }, { words: 'x' }, 'junk', { words: 'Not Normal', id: 'b', title: 'B', at: 2 }] }
    expect(sanitizeRememberedSongs(raw).songs).toEqual([{ words: 'song a', id: a.id, title: 'Song A', at: 1 }])
    expect(sanitizeRememberedSongs('nope')).toEqual(EMPTY_REMEMBERED_SONGS)
  })

  it('a song stays once it has played 30 s', () => {
    expect(stayed(29.9)).toBe(false)
    expect(stayed(30)).toBe(true)
  })
})

describe('a song title trimmed for the Learned Terms', () => {
  it('drops the bracket noise, the pipe tail, prod. and ft.', () => {
    expect(trimSongTitle('Midnight Drive (Official Video)')).toBe('Midnight Drive')
    expect(trimSongTitle('Midnight Drive [unreleased]')).toBe('Midnight Drive')
    expect(trimSongTitle('Midnight Drive | prod. x')).toBe('Midnight Drive')
    expect(trimSongTitle('Midnight Drive prod. by Someone')).toBe('Midnight Drive')
    expect(trimSongTitle('Midnight Drive ft. Someone Else')).toBe('Midnight Drive')
    expect(trimSongTitle('Midnight Drive (feat. Someone) [Official Audio] | 2026')).toBe('Midnight Drive')
    expect(trimSongTitle('“Midnight Drive”')).toBe('Midnight Drive')
  })

  it('learns the title, and each side of an artist–song dash', () => {
    expect(songTerms('Midnight Drive (Official Video)')).toEqual(['Midnight Drive'])
    expect(songTerms('Lumen - Midnight Drive [unreleased]')).toEqual(['Lumen Midnight Drive', 'Lumen', 'Midnight Drive'])
    // A title past four words is no Learned Term: its sides still are.
    expect(songTerms('The Long Name Band - Midnight Drive')).toEqual(['The Long Name Band', 'Midnight Drive'])
    expect(songTerms('(Official Video)')).toEqual([])
  })
})
