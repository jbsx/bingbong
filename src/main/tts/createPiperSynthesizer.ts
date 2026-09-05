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

/**
 * One piper process per line: text on stdin, raw s16le mono PCM on stdout
 * (`--output-raw`), wrapped as WAV for the player. Spawning per line keeps
 * the model warm only for the utterance; if start latency becomes audible, a
 * persistent piper with length-delimited output is the upgrade path.
 */
export function createPiperSynthesizer(deps: PiperSynthesizerDeps): SpeechSynthesizer {
  const spawnFn = deps.spawnFn ?? nodeSpawn
  const readDirFn = deps.readDirFn ?? ((dir: string) => readdir(dir))
  const readFileFn = deps.readFileFn ?? ((path: string) => readFile(path, 'utf8'))

  async function synthesize(text: string): Promise<Uint8Array> {
    const voiceId = deps.getVoiceId()

    let files: string[]
    try {
      files = await readDirFn(deps.voicesDir)
    } catch (err) {
      throw new Error(`piper voices dir not readable (${deps.voicesDir}): ${toMessage(err)}`)
    }

    const modelFile = resolveVoiceFile(files, voiceId)
    if (modelFile === null) {
      throw new Error(`piper voice '${voiceId}' not found in ${deps.voicesDir}`)
    }
    const modelPath = join(deps.voicesDir, modelFile)
    const configPath = `${modelPath}.json`

    let sampleRate = DEFAULT_PIPER_SAMPLE_RATE
    try {
      sampleRate = sampleRateFromVoiceConfig(JSON.parse(await readFileFn(configPath)))
    } catch (error) {
      reportFault('tts.createPiperSynthesizer.voiceConfig', error)
      // Missing/malformed config — the voice default still plays correctly.
    }

    const pcm = await runPiper(spawnFn, { bin: deps.bin, modelPath, configPath }, text)
    return wrapRawPcmAsWav(pcm, sampleRate)
  }

  return { synthesize }
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
