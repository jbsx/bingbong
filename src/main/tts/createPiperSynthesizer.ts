import { spawn as nodeSpawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SpeechSynthesizer } from '../../core/ports/tts'
import { DEFAULT_PIPER_SAMPLE_RATE, resolveVoiceFile, sampleRateFromVoiceConfig } from '../../core/tts/piperVoices'
import { wrapRawPcmAsWav } from '../../core/tts/wav'
import { reportFault } from '../../core/trace/fault'

export interface PiperSynthesizerDeps {
  bin: string
  voicesDir: string
  /** Resolved per line, so a settings-page voice change applies immediately. */
  getVoiceId(): string
  spawnFn?: typeof nodeSpawn
  readDirFn?: (dir: string) => Promise<string[]>
  readFileFn?: (path: string) => Promise<string>
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A voice's model and config paths in the voices dir; rejects with a descriptive error when the dir or the voice is missing. */
export async function resolvePiperVoice(
  voicesDir: string,
  voiceId: string,
  readDirFn: (dir: string) => Promise<string[]>,
): Promise<{ modelPath: string; configPath: string }> {
  let files: string[]
  try {
    files = await readDirFn(voicesDir)
  } catch (err) {
    throw new Error(`piper voices dir not readable (${voicesDir}): ${toMessage(err)}`)
  }

  const modelFile = resolveVoiceFile(files, voiceId)
  if (modelFile === null) {
    throw new Error(`piper voice '${voiceId}' not found in ${voicesDir}`)
  }
  const modelPath = join(voicesDir, modelFile)
  return { modelPath, configPath: `${modelPath}.json` }
}

/**
 * One piper process per line: text on stdin, raw s16le mono PCM on stdout
 * (`--output-raw`), wrapped as WAV for the player. The fallback behind the
 * persistent piper (#327, createPersistentPiperSynthesizer.ts) when that
 * process cannot start: it pays the model load on every line.
 */
export function createPiperSynthesizer(deps: PiperSynthesizerDeps): SpeechSynthesizer {
  const spawnFn = deps.spawnFn ?? nodeSpawn
  const readDirFn = deps.readDirFn ?? ((dir: string) => readdir(dir))
  const readFileFn = deps.readFileFn ?? ((path: string) => readFile(path, 'utf8'))
  let spawns = 0

  async function synthesize(text: string): Promise<Uint8Array> {
    const { modelPath, configPath } = await resolvePiperVoice(deps.voicesDir, deps.getVoiceId(), readDirFn)

    let sampleRate = DEFAULT_PIPER_SAMPLE_RATE
    try {
      sampleRate = sampleRateFromVoiceConfig(JSON.parse(await readFileFn(configPath)))
    } catch (error) {
      reportFault('tts.createPiperSynthesizer.voiceConfig', error)
      // Missing/malformed config — the voice default still plays correctly.
    }

    spawns += 1
    const pcm = await runPiper(spawnFn, { bin: deps.bin, modelPath, configPath }, text)
    return wrapRawPcmAsWav(pcm, sampleRate)
  }

  return { synthesize, spawnCount: () => spawns }
}

interface PiperInvocation {
  bin: string
  modelPath: string
  configPath: string
}

function runPiper(
  spawnFn: typeof nodeSpawn,
  invocation: PiperInvocation,
  text: string,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawnFn(invocation.bin, [
      '--model',
      invocation.modelPath,
      '--config',
      invocation.configPath,
      '--output-raw',
    ])
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }

    child.on('error', (err) => fail(new Error(`failed to start piper at '${invocation.bin}': ${err.message}`)))
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (code === 0) {
        resolve(new Uint8Array(Buffer.concat(stdout)))
      } else {
        const detail = Buffer.concat(stderr).toString().trim()
        reject(new Error(`piper exited with code ${String(code)}${detail === '' ? '' : `: ${detail}`}`))
      }
    })

    // A dying piper closes our stdin early; the close event reports the real error.
    child.stdin.on('error', () => {})
    child.stdin.write(text)
    child.stdin.end()
  })
}
