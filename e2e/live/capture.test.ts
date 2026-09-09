import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FixtureServer } from '../fixtureServer'
import { captureFilePath, DEFAULT_ATTEMPT_BOUNDS, MEASUREMENT_FAULT_REASONS, normalizeCommandText, startCaptureSession } from './capture.ts'

// The launch-free half of the capture lifecycle (#224): what fails
// before any Electron process exists, and where a capture lands.

const fixture = { url: (path: string) => `http://127.0.0.1:1${path}` } as FixtureServer

describe('startCaptureSession, before any launch', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'live-capture-unit-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses a reused capture identity first, before a profile or a launch', async () => {
    mkdirSync(join(root, 'cap-1'))
    await expect(startCaptureSession({ mode: 'verification', captureId: 'cap-1', huntId: 'h', root, verification: { env: {}, fixture } })).rejects.toThrow(
      /refusing to reuse capture identity/,
    )
  })

  it('refuses real credentials in verification mode and leaves no profile behind', async () => {
    await expect(
      startCaptureSession({
        mode: 'verification',
        captureId: 'cap-2',
        huntId: 'h',
        root,
        verification: { env: { BINGBONG_LLM_SCRIPT: '[]', ZAI_API_KEY: 'sk-real-key' }, fixture },
      }),
    ).rejects.toThrow(/refuses real routing/)
    // The identity was claimed (a directory exists) but nothing was launched or written into it.
    expect(readdirSync(join(root, 'cap-2'))).toEqual([])
  })

  it('normalizes a command the way the Prompt Bar submits it, and refuses what the bar would alter', () => {
    expect(normalizeCommandText('  find the fare  ')).toBe('find the fare')
    expect(() => normalizeCommandText('find the fare\n')).toThrow(/single line/)
    expect(() => normalizeCommandText('   ')).toThrow(/not be empty/)
  })

  it('names the capture file and the measurement-fault stop reasons', () => {
    expect(captureFilePath('cap-9', '/tmp/x')).toBe('/tmp/x/cap-9/capture.json')
    expect(MEASUREMENT_FAULT_REASONS).toEqual(['observer_failure', 'acceptance_timeout', 'rejected'])
    expect(DEFAULT_ATTEMPT_BOUNDS.attemptMs).toBe(20 * 60_000)
    expect(existsSync(root)).toBe(true)
  })
})
