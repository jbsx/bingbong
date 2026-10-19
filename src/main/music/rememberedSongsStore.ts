import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  EMPTY_REMEMBERED_SONGS,
  forgetVideo,
  forgetWords,
  recallSong,
  rememberSong,
  sanitizeRememberedSongs,
  type RememberedSongs,
} from '../../core/music/rememberedSongs'
import { reportFault } from '../../core/trace/fault'
import type { SongMemory } from './player'

// The Remembered Songs' persistence (#345): songs.json in userData beside
// the Learned Terms' lexicon.json, kept across restarts as they are (the
// queue is not). The rules live in core (rememberedSongs.ts); this store
// owns the file and the clock. A corrupt file fails closed to no songs —
// every `play` searches — and the next stay replaces it.

export function createRememberedSongsStore(path: string, deps?: { now?: () => number }): SongMemory {
  const now = deps?.now ?? (() => Date.now())
  let state: RememberedSongs = EMPTY_REMEMBERED_SONGS
  if (existsSync(path)) {
    try {
      state = sanitizeRememberedSongs(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      reportFault('music.rememberedSongsStore.load', error)
    }
  }

  function commit(next: RememberedSongs): void {
    if (next === state) return
    state = next
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    } catch (error) {
      reportFault('music.rememberedSongsStore.persist', error)
    }
  }

  return {
    recall: (words) => recallSong(state, words),
    remember: (words, song) => commit(rememberSong(state, words, song, now())),
    forgetWords: (words) => commit(forgetWords(state, words)),
    forgetVideo(id) {
      const forgot = forgetVideo(state, id)
      commit(forgot.songs)
      return forgot.forgot
    },
  }
}
