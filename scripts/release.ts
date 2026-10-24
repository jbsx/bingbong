#!/usr/bin/env node
// `pnpm release [commit]` (#419, ADR 0090): ship a commit already on `main`
// to the kiosk by fast-forwarding `production` to it (default: origin/main).
// The Release workflow builds and publishes it; the kiosk installs it at its
// Idle Screen. Agents run this only on the owner's word in the turn.

import { execFileSync } from 'node:child_process'

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim()
const fail = (message: string): never => {
  console.error(`release: ${message}`)
  process.exit(1)
}

git('fetch', '--quiet', 'origin', 'main')
// The first release creates production; from then on it is fetched to check the fast-forward.
const hasProduction = git('ls-remote', '--heads', 'origin', 'production') !== ''
if (hasProduction) git('fetch', '--quiet', 'origin', 'production')
const wanted = process.argv[2] ?? 'origin/main'
let sha = ''
try {
  sha = git('rev-parse', '--verify', `${wanted}^{commit}`)
} catch {
  fail(`${wanted} is not a commit`)
}
try {
  git('merge-base', '--is-ancestor', sha, 'origin/main')
} catch {
  fail(`${wanted} is not on main: production only takes commits already on main`)
}
if (hasProduction) {
  try {
    git('merge-base', '--is-ancestor', 'origin/production', sha)
  } catch {
    fail(`${wanted} is not ahead of production: production only fast-forwards`)
  }
}

console.log(`release: shipping ${git('log', '-1', '--format=%h %s', sha)}`)
// No --force, ever: the push is refused unless it fast-forwards.
execFileSync('git', ['push', 'origin', `${sha}:refs/heads/production`], { stdio: 'inherit' })
console.log('release: the Release workflow builds it now — gh run list --workflow release.yml')
