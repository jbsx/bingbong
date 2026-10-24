import { execFile } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ensureModelFiles, fsMoonshineStore, type MoonshineModelStore } from '../moonshine/moonshineModels'

// Piper on first launch (#419, ADR 0090): the binary from rhasspy/piper's
// GitHub release and the en_GB-alba voice download into the profile the
// way speech-to-text does — a `.part` file renamed when whole, retried on
// the next use — so an installed app speaks with nothing set up by hand.

/** The release the binary comes from: its archive and the size a whole download is at least. */
export interface PiperRelease {
  url: string
  minBytes: number
}

const RELEASE_BASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2'

/** The release for this machine; null where none is wired (the Mac build is later), and piper is found on PATH. */
export function piperReleaseFor(platform: string, arch: string): PiperRelease | null {
  if (platform === 'linux' && arch === 'x64') return { url: `${RELEASE_BASE}/piper_linux_x86_64.tar.gz`, minBytes: 25_000_000 }
  return null
}

const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium'

/** The default voice's model and config (DEFAULT_PIPER_VOICE resolves to its medium file). */
export const PIPER_VOICE_FILES = [
  { name: 'en_GB-alba-medium.onnx', url: `${VOICE_BASE}/en_GB-alba-medium.onnx`, minBytes: 60_000_000 },
  { name: 'en_GB-alba-medium.onnx.json', url: `${VOICE_BASE}/en_GB-alba-medium.onnx.json`, minBytes: 4_000 },
] as const

/** The executable inside the installed release: the archive unpacks to `piper/`, libraries and espeak data beside it. */
export function installedPiperBin(piperDir: string): string {
  return join(piperDir, 'piper', 'piper')
}

export interface PiperInstallPlan {
  /** Where the release unpacks: <userData>/piper. */
  piperDir: string
  voicesDir: string
  /** Null when Piper is not the app's to install — BINGBONG_PIPER_BIN is set, or no release fits this machine — and then neither is its voice. */
  release: PiperRelease | null
}

export interface PiperInstallDeps {
  store: MoonshineModelStore
  /** Unpack a .tar.gz into a directory (the release holds symlinks, so tar does it). */
  extract(archive: string, intoDir: string): Promise<void>
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface InstalledPiper {
  /** The installed executable, or null when the binary was not this install's. */
  bin: string | null
  /** What this call fetched: 'piper' for the binary, else the voice files' names. */
  fetched: string[]
}

/**
 * Guarantees the binary and the default voice are whole, when Piper is the
 * app's: one's own binary brings its own voices. The archive unpacks into a scratch dir that is moved into place
 * only once complete, so a cut unpack never passes for an install.
 */
export async function ensurePiper(plan: PiperInstallPlan, deps: PiperInstallDeps): Promise<InstalledPiper> {
  if (plan.release === null) return { bin: null, fetched: [] }
  const fetched: string[] = []
  const bin = installedPiperBin(plan.piperDir)
  if (!deps.store.exists(bin)) {
    const archive = join(plan.piperDir, 'piper.tar.gz')
    const unpacking = join(plan.piperDir, 'unpacking')
    // A whole archive from a cut unpack is reused; anything less is fetched again.
    const whole = deps.store.exists(archive) && (deps.store.size?.(archive) ?? 0) >= plan.release.minBytes
    if (!whole) await deps.store.fetch(plan.release.url, archive)
    await deps.remove(unpacking)
    await deps.extract(archive, unpacking)
    await deps.move(join(unpacking, 'piper'), join(plan.piperDir, 'piper'))
    await deps.remove(unpacking)
    await deps.remove(archive)
    fetched.push('piper')
  }
  const voice = await ensureModelFiles(plan.voicesDir, PIPER_VOICE_FILES, deps.store)
  return { bin, fetched: [...fetched, ...voice.fetched] }
}

const execFileAsync = promisify(execFile)

/** Node fs, fetch and the system's tar, for the app. */
export const fsPiperInstallDeps: PiperInstallDeps = {
  store: fsMoonshineStore,
  async extract(archive, intoDir) {
    await mkdir(intoDir, { recursive: true })
    await execFileAsync('tar', ['-xzf', archive, '-C', intoDir])
  },
  async move(from, to) {
    await rm(to, { recursive: true, force: true })
    await rename(from, to)
  },
  remove: (path) => rm(path, { recursive: true, force: true }),
}
