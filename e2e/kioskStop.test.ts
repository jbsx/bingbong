import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The kiosk unit's stop (#434), as scripts/kiosk-install.sh writes it. It is
// never run here (it signals the processes of the cgroup it runs in); what is
// checked is what systemd will hand /bin/sh: every `$` but `$MAINPID` escaped
// as `$$`, no `%` specifier, a script sh can parse, and the order the
// measure settled — the strays off the mount first, then the app.

const install = readFileSync(join(process.cwd(), 'scripts/kiosk-install.sh'), 'utf8')
const unitLine = install.split('\n').find((line) => line.startsWith('ExecStop='))!

/** What systemd runs: `$MAINPID` substituted, `$$` collapsed to `$`. */
function asSystemdRunsIt(line: string): string {
  const body = line.replace(/^ExecStop=\/bin\/sh -c '/, '').replace(/'$/, '')
  return body.replace(/\$MAINPID/g, '4242').replace(/\$\$/g, '$')
}

describe('the kiosk unit stop (#434)', () => {
  it('is written by a quoted heredoc, so the shell installing it expands nothing', () => {
    const before = install.slice(0, install.indexOf(unitLine))
    expect(before.slice(before.lastIndexOf('<<')).startsWith("<<'EOF'")).toBe(true)
  })

  it('leaves systemd nothing to expand but $MAINPID: every other $ doubled, no % specifier', () => {
    expect(unitLine).toMatch(/^ExecStop=\/bin\/sh -c '.*'$/)
    expect(unitLine).not.toContain('%')
    const bare = unitLine.replace(/\$MAINPID/g, '').replace(/\$\$/g, '')
    expect(bare).not.toContain('$')
  })

  it('is a script sh parses', () => {
    expect(() => execFileSync('sh', ['-n', '-c', asSystemdRunsIt(unitLine)])).not.toThrow()
  })

  it('ends the strays before the app, and waits for the app before the rest', () => {
    const script = asSystemdRunsIt(unitLine)
    const strays = script.indexOf('kill -TERM $s')
    const app = script.indexOf('kill -TERM 4242')
    const appGone = script.indexOf('while kill -0 4242')
    const rest = script.indexOf('for p in $a')
    expect(strays).toBeGreaterThan(-1)
    expect(strays).toBeLessThan(app)
    expect(app).toBeLessThan(appGone)
    expect(appGone).toBeLessThan(rest)
  })
})
