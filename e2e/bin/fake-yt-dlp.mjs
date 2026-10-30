#!/usr/bin/env node
// A scripted yt-dlp for the e2e suite (#502): the audio road's lookup with
// no network. It prints BINGBONG_FAKE_YTDLP_STREAM as the stream's address
// after BINGBONG_FAKE_YTDLP_MS, as the kiosk's took about 4.6 s — asked with
// `-O '%(available_at)s %(url)s'`, beside the time it is served,
// BINGBONG_FAKE_YTDLP_SERVED_MS after it is printed ("NA" without); with the
// file BINGBONG_FAKE_YTDLP_FAIL names present, it fails as a refused lookup
// does. Each lookup's arguments are appended to BINGBONG_FAKE_YTDLP_LOG. Its
// step line comes before the address, as the real one's do with `--no-quiet`.

import { appendFileSync, existsSync } from 'node:fs'

const { BINGBONG_FAKE_YTDLP_STREAM: stream, BINGBONG_FAKE_YTDLP_MS: ms, BINGBONG_FAKE_YTDLP_SERVED_MS: served, BINGBONG_FAKE_YTDLP_FAIL: fail, BINGBONG_FAKE_YTDLP_LOG: log } = process.env
const withTime = process.argv.includes('-O')
if (log) appendFileSync(log, `yt-dlp ${process.argv.slice(2).join(' ')}\n`)
if (withTime) process.stdout.write('[youtube] scripted: Downloading webpage\n')
setTimeout(() => {
  if ((fail && existsSync(fail)) || !stream) {
    process.stderr.write('ERROR: [youtube] scripted: the lookup was refused\n')
    process.exit(1)
  }
  const at = served === undefined ? 'NA' : String((Date.now() + Number(served)) / 1000)
  process.stdout.write(withTime ? `${at} ${stream}\n` : `${stream}\n`)
}, Number(ms ?? 0))
