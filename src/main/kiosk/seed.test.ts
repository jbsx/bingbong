import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applySeed } from './seed'

// The kiosk deployment's first-run contract (ADR 0023): assets baked into the
// image are mirrored into the bind-mounted userData dir before the app boots.
// The seam is applySeed(bakedRoot, userDataDir) against real temp dirs —
// copy-if-missing, never overwrite, atomic per file, idempotent.

const tempRoots: string[] = []

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bingbong-seed-${label}-`))
  tempRoots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function writeFile(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents)
}

describe('applySeed', () => {
  it('copies missing files recursively, preserving relative paths', () => {
    const baked = tempDir('baked')
    const data = tempDir('data')
    writeFile(join(baked, 'models', 'silero_vad.onnx'), 'vad')
    writeFile(join(baked, 'models', 'wake', 'bing_bong.onnx'), 'head')
    writeFile(join(baked, 'voices', 'en_US-ryan-medium.onnx'), 'voice')

    const result = applySeed(baked, data)

    expect(result.copied).toBe(3)
    expect(readFileSync(join(data, 'models', 'silero_vad.onnx'), 'utf8')).toBe('vad')
    expect(readFileSync(join(data, 'models', 'wake', 'bing_bong.onnx'), 'utf8')).toBe('head')
    expect(readFileSync(join(data, 'voices', 'en_US-ryan-medium.onnx'), 'utf8')).toBe('voice')
  })

  it('never overwrites a file the data dir already has', () => {
    const baked = tempDir('baked')
    const data = tempDir('data')
    writeFile(join(baked, 'models', 'silero_vad.onnx'), 'baked')
    writeFile(join(data, 'models', 'silero_vad.onnx'), 'user')

    const result = applySeed(baked, data)

    expect(result.copied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(readFileSync(join(data, 'models', 'silero_vad.onnx'), 'utf8')).toBe('user')
  })

  it('is idempotent — a second run copies nothing', () => {
    const baked = tempDir('baked')
    const data = tempDir('data')
    writeFile(join(baked, 'models', 'moonshine-small', 'encoder_model.onnx'), 'enc')

    applySeed(baked, data)
    const second = applySeed(baked, data)

    expect(second.copied).toBe(0)
    expect(second.skipped).toBe(1)
  })

  it('leaves no partial files behind and recovers from a stale one', () => {
    const baked = tempDir('baked')
    const data = tempDir('data')
    writeFile(join(baked, 'models', 'silero_vad.onnx'), 'vad')
    // A previous seed run killed mid-copy: its temp file lingers, dest missing.
    mkdirSync(join(data, 'models'), { recursive: true })
    writeFileSync(join(data, 'models', 'silero_vad.onnx.seed-partial'), 'garbage')

    const result = applySeed(baked, data)

    expect(result.copied).toBe(1)
    expect(readFileSync(join(data, 'models', 'silero_vad.onnx'), 'utf8')).toBe('vad')
    expect(existsSync(join(data, 'models', 'silero_vad.onnx.seed-partial'))).toBe(false)
  })

  it('seeds nothing when the baked root is absent', () => {
    const data = tempDir('data')
    const missingBaked = join(data, 'no-such-baked-root')

    const result = applySeed(missingBaked, data)

    expect(result.copied).toBe(0)
    expect(result.skipped).toBe(0)
  })
})
