#!/usr/bin/env node
// A scripted yt-dlp for the e2e suite (#502): the audio road's lookup with
// no network. It prints BINGBONG_FAKE_YTDLP_STREAM as the stream's address
// after BINGBONG_FAKE_YTDLP_MS, as the kiosk's took about 4.6 s; with the
// file BINGBONG_FAKE_YTDLP_FAIL names present, it fails as a refused lookup
// does. Each lookup's arguments are appended to BINGBONG_FAKE_YTDLP_LOG.

import { appendFileSync, existsSync } from 'node:fs'

const { BINGBONG_FAKE_YTDLP_STREAM: stream, BINGBONG_FAKE_YTDLP_MS: ms, BINGBONG_FAKE_YTDLP_FAIL: fail, BINGBONG_FAKE_YTDLP_LOG: log } = process.env
if (log) appendFileSync(log, `yt-dlp ${process.argv.slice(2).join(' ')}\n`)
setTimeout(() => {
  if ((fail && existsSync(fail)) || !stream) {
    process.stderr.write('ERROR: [youtube] scripted: the lookup was refused\n')
    process.exit(1)
  }
  process.stdout.write(`${stream}\n`)
}, Number(ms ?? 0))
