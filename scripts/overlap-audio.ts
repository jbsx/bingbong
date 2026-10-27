#!/usr/bin/env node
// `pnpm overlap:audio` (#486): the stand-in audio of the spoken Sequence
// Cases, synthesized with Piper into fixtures/overlap-cases/audio/ from the
// manifest there (stand-ins.json: each file's words and voice). A line no
// utterance dump holds is a stand-in until one exists; the person's voice is
// never alba, the app's own, and "another voice" is a second Piper voice.
// Only missing files are made (`--force` remakes every one), as 16 kHz mono
// s16 WAVs like every dump. Needs Piper and the voices the app's TTS loads
// (~/.config/bingbong/piper, ~/.config/bingbong/voices; BINGBONG_PIPER_BIN
// and BINGBONG_PIPER_VOICE_DIR override) and ffmpeg.
// Node runs this .ts directly via type stripping (#36).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AUDIO_DIR = fileURLToPath(new URL('../fixtures/overlap-cases/audio/', import.meta.url))
const CONFIG_DIR = join(homedir(), '.config', 'bingbong')
const piper = process.env.BINGBONG_PIPER_BIN ?? join(CONFIG_DIR, 'piper', 'piper', 'piper')
const voices = process.env.BINGBONG_PIPER_VOICE_DIR ?? join(CONFIG_DIR, 'voices')
const force = process.argv.includes('--force')

const manifest = JSON.parse(readFileSync(join(AUDIO_DIR, 'stand-ins.json'), 'utf8')) as { files: Record<string, { words: string; voice: string }> }
const scratch = mkdtempSync(join(tmpdir(), 'bingbong-overlap-audio-'))
let made = 0
try {
  for (const [file, { words, voice }] of Object.entries(manifest.files)) {
    const out = join(AUDIO_DIR, file)
    if (existsSync(out) && !force) continue
    if (voice.startsWith('en_GB-alba')) throw new Error(`${file}: alba is the app's own voice; a person's line takes another`)
    const raw = join(scratch, `${file}.raw.wav`)
    const spoke = spawnSync(piper, ['--model', join(voices, `${voice}.onnx`), '--output_file', raw], { input: words, encoding: 'utf8' })
    if (spoke.status !== 0) throw new Error(`${file}: piper failed: ${spoke.stderr.slice(-400)}`)
    const encoded = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', out], { encoding: 'utf8' })
    if (encoded.status !== 0) throw new Error(`${file}: ffmpeg failed: ${encoded.stderr.slice(-400)}`)
    console.log(`${file}: "${words}" in ${voice}`)
    made += 1
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
console.log(`${made} made, ${Object.keys(manifest.files).length - made} already there`)
