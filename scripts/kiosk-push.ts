#!/usr/bin/env node
// `pnpm kiosk:push [--dirty] [--skip-checks]`: build the AppImage on this PC
// and put it on the kiosk over scp, in place of a Release (ADR 0090) while the
// GitHub account is suspended. Checks and builds HEAD, copies it beside the
// installed AppImage, swaps it in with one `mv`, and restarts the service.
// The restart cuts off whatever the kiosk is doing: run it when idle.
//
// The kiosk is BINGBONG_KIOSK (default jbsx@192.168.1.217), set up once with
// scripts/kiosk-install.sh. The version is the next patch after the newest
// tag, as a `-local.<UTC minute>` prerelease: newer than every Release so far,
// older than the next one, so the updater moves on by itself once Releases
// are back.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KIOSK = process.env.BINGBONG_KIOSK ?? 'jbsx@192.168.1.217'
// Where kiosk-install.sh puts the AppImage and the unit that runs it.
const APPIMAGE = '.local/bin/bingbong.AppImage'
const SERVICE = 'bingbong'

const args = process.argv.slice(2)
const run = (cmd: string, ...rest: string[]): void => {
  execFileSync(cmd, rest, { stdio: 'inherit' })
}
const read = (cmd: string, ...rest: string[]): string => execFileSync(cmd, rest, { encoding: 'utf8' }).trim()
const say = (message: string): void => {
  console.log(`kiosk:push: ${message}`)
}
const fail = (message: string): never => {
  console.error(`kiosk:push: ${message}`)
  process.exit(1)
}

if (read('git', 'status', '--porcelain') !== '' && !args.includes('--dirty'))
  fail('the tree has uncommitted changes; commit them, or pass --dirty to ship them anyway')

const tag = read('git', 'describe', '--tags', '--abbrev=0', '--match', 'v*')
const [major, minor, patch] = tag.replace(/^v/, '').split('.').map(Number)
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
const version = `${major}.${minor}.${patch + 1}-local.${stamp}`
say(`building ${read('git', 'log', '-1', '--format=%h %s')} as ${version}`)

if (!args.includes('--skip-checks')) {
  run('pnpm', 'typecheck')
  run('pnpm', 'test')
}
run('pnpm', 'build')
run('pnpm', 'exec', 'electron-builder', '--linux', 'AppImage', '--publish', 'never', `-c.extraMetadata.version=${version}`)
const built = `dist/bingbong-${version}.AppImage`
if (!existsSync(built)) fail(`electron-builder made no ${built}`)

// One connection for every step, so a password is asked once.
const socket = join(mkdtempSync(join(tmpdir(), 'kiosk-push-')), 'ssh')
const shared = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${socket}`, '-o', 'ControlPersist=120']
const onKiosk = (script: string): void => {
  run('ssh', ...shared, KIOSK, script)
}

onKiosk(`test -f ${APPIMAGE} || { echo "no ${APPIMAGE}: run scripts/kiosk-install.sh on the kiosk first"; exit 1; }`)
say(`copying to ${KIOSK}`)
run('scp', ...shared, built, `${KIOSK}:${APPIMAGE}.part`)
// The running app has its AppImage mounted; mv swaps the file without touching it.
onKiosk(
  `chmod +x ${APPIMAGE}.part && mv ${APPIMAGE}.part ${APPIMAGE} && ` +
    `systemctl --user restart ${SERVICE} && sleep 3 && systemctl --user is-active ${SERVICE}`,
)
run('ssh', ...shared, '-O', 'exit', KIOSK)
say(`${version} is running on ${KIOSK}`)
