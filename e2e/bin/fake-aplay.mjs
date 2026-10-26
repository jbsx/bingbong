#!/usr/bin/env node
// A scripted aplay for the e2e suite (#327): reads what it is played and
// plays nothing, appending its arguments and the bytes it was handed to
// BINGBONG_FAKE_TTS_LOG, when set. BINGBONG_FAKE_APLAY_MS holds it open
// that long after its input ends, as a real player plays (#472): the app is
// speaking for a window the screen can be watched in.

import { appendFileSync } from 'node:fs'

const log = process.env.BINGBONG_FAKE_TTS_LOG
let bytes = 0
process.stdin.on('data', (chunk) => (bytes += chunk.length))
process.stdin.on('end', () => {
  if (log) appendFileSync(log, `aplay ${process.argv.slice(2).join(' ')} bytes=${bytes}\n`)
  const holdMs = Number(process.env.BINGBONG_FAKE_APLAY_MS ?? 0)
  if (holdMs > 0) setTimeout(() => {}, holdMs)
})
