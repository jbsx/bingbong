#!/usr/bin/env node
// A scripted piper for the e2e suite (#327): every hermetic launch speaks
// through it, so no e2e run loads a voice or reaches the sound card. It
// speaks piper's two protocols — `-d <dir>`, one WAV per stdin line and
// its path logged on stderr as the Python piper does (the persistent route),
// and `--output-raw`, raw PCM for one text (the per-line fallback) — and
// appends what it was given to BINGBONG_FAKE_TTS_LOG, when set.

import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const log = process.env.BINGBONG_FAKE_TTS_LOG
const note = (line) => {
  if (log) appendFileSync(log, `${line}\n`)
}

/** 0.1 s of silence at 22050 Hz, s16le mono. */
const PCM = Buffer.alloc(2205 * 2)

function wav(pcm) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(22050, 24)
  header.writeUInt32LE(44100, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

const dirAt = args.indexOf('-d')
note(`piper-start ${dirAt === -1 ? 'per-line' : 'persistent'}`)

if (dirAt === -1) {
  let text = ''
  process.stdin.on('data', (chunk) => (text += chunk))
  process.stdin.on('end', () => {
    note(`piper-line ${text.trim()}`)
    process.stdout.write(PCM)
  })
} else {
  const dir = args[dirAt + 1]
  let count = 0
  createInterface({ input: process.stdin }).on('line', (line) => {
    const text = line.trim()
    if (text === '') return
    note(`piper-line ${text}`)
    count += 1
    const path = join(dir, `${process.pid}-${count}.wav`)
    writeFileSync(path, wav(PCM))
    process.stderr.write(`INFO:__main__:Wrote ${path}\n`)
  })
}
