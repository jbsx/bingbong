import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { songTerms } from '../../core/music/rememberedSongs'
import { nameMatch } from '../../core/command/nameMatch'
import { seedLexiconSet } from '../moonshine/biasLexicon'
import { createLearnedTermsStore } from '../voice/learnedTermsStore'
import { createRememberedSongsStore } from './rememberedSongsStore'

// The Remembered Songs' persistence (#345): songs.json beside the Learned
// Terms' lexicon.json. The ledger's rules live in core and are tested
// there; these pin the file: a song survives a restart, a forgotten one
// stays forgotten, and a corrupt file fails closed to none.

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function songsPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bingbong-songs-'))
  dirs.push(dir)
  return join(dir, 'songs.json')
}

const song = { id: 'aaaaaaaaaaa', title: 'Song A' }

describe('the Remembered Songs store', () => {
  it('a remembered song survives a restart, and a forgotten one stays forgotten', async () => {
    const path = await songsPath()
    createRememberedSongsStore(path).remember('Song A', song)
    const restarted = createRememberedSongsStore(path)
    expect(restarted.recall('song a')).toEqual(song)
    expect(restarted.forgetVideo(song.id)).toBe(true)
    expect(createRememberedSongsStore(path).recall('song a')).toBeNull()
  })

  it('a corrupt file reads as no songs, and the next stay replaces it', async () => {
    const path = await songsPath()
    await writeFile(path, '{ not json', 'utf8')
    const store = createRememberedSongsStore(path)
    expect(store.recall('song a')).toBeNull()
    store.remember('song a', song)
    expect(createRememberedSongsStore(path).recall('song a')).toEqual(song)
  })

  it('the title a song that stayed teaches biases the next decode, and the Name Match carries its spelling (AC3)', async () => {
    const lexicon = createLearnedTermsStore(join(await songsPath(), '..', 'lexicon.json'), seedLexiconSet())
    // As main wires the Player's `learn`: each trimmed term admitted at once.
    for (const term of songTerms('Lumen - Midnight Drive (Official Video) [unreleased]')) lexicon.admit(term)
    expect(lexicon.biasPhrases()).toContain('midnight drive')
    expect(nameMatch('midnight dryve', lexicon.list())?.candidate).toBe('midnight drive')
  })
})
