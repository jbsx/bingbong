#!/usr/bin/env node
// A yt-dlp that prints a stream's address only once YouTube serves it
// (#502, 2026-10-28): yt-dlp 2026.10.26's TVHTML5 streams answer 403 until
// their `available_at`, about 5 s after the lookup (yt-dlp itself sleeps for
// it: "Sleeping 5.00 seconds as required by the site"), and the audio road
// sets the element's source at once, so every song on dev fell back to its
// watch page. Named by BINGBONG_AUDIO_ROAD, it runs the yt-dlp on PATH with
// the road's own arguments, waits out `available_at`, then prints the
// address as `-g` does. The overlap gate's arm "on + wait" uses it to see
// the road a song would take once the app waits itself.

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2).filter((arg) => arg !== '-g')
const at = args.indexOf('--')
const printed = execFileSync(process.env.BINGBONG_REAL_YT_DLP ?? 'yt-dlp', [...args.slice(0, at), '-O', '%(available_at)s %(url)s', ...args.slice(at)], { encoding: 'utf8' }).trim()
const [available, url] = printed.split(' ')
const waitMs = Number(available) * 1000 - Date.now()
if (Number.isFinite(waitMs) && waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs + 250))
process.stdout.write(`${url}\n`)
