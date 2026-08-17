import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
} from 'node:fs'
import { unlink } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Tool } from '../../core/pipeline/tool'
import { sanitizeDownloadFilename, uniqueDownloadPath } from '../../core/downloads/downloadRouting'

// File-capable background agents are confined to bingbong_downloads. Their
// spawn is confirmation-gated by spawn_agent, so the approved task may fetch
// direct URLs and organize the resulting files without arbitrary filesystem
// access or repeated confirmation prompts.

export interface BackgroundToolsDeps {
  downloadsDir: string
  fetchFn: typeof fetch
  maxDownloadBytes?: number
}

const DEFAULT_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024

function stringArg(value: unknown, name: string, tool: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${tool}: '${name}' must be a non-empty string`)
  }
  return value.trim()
}

function rootPath(root: string): string {
  mkdirSync(root, { recursive: true })
  return realpathSync(root)
}

function confinedPath(root: string, requested: string, tool: string): string {
  const base = rootPath(root)
  const target = resolve(base, requested)
  if (target === base || !target.startsWith(`${base}${sep}`)) {
    throw new Error(`${tool}: path must stay inside the downloads directory`)
  }

  // Lexical confinement alone is insufficient: an in-root symlink can point
  // outside. Reject every existing symlink component before any mutation.
  let current = base
  for (const segment of relative(base, target).split(sep)) {
    current = resolve(current, segment)
    if (!existsSync(current)) break
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${tool}: symlink paths are not allowed`)
    }
  }
  return target
}

function filenameFrom(url: URL, requested: unknown): string {
  if (typeof requested === 'string' && requested.trim() !== '') {
    return sanitizeDownloadFilename(requested.trim())
  }
  const last = url.pathname.split('/').filter(Boolean).at(-1)
  return sanitizeDownloadFilename(last || 'download')
}

export function createBackgroundTools(deps: BackgroundToolsDeps): Tool[] {
  const maxDownloadBytes = deps.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
  return [
    {
      name: 'download_url',
      description: 'Download a direct HTTP(S) URL into the approved Bing Bong downloads directory.',
      parameters: {
        url: { type: 'string', description: 'Direct HTTP(S) URL to download' },
        filename: {
          type: 'string',
          description: 'Optional destination filename; defaults to the URL filename',
          required: false,
        },
      },
      async execute(call) {
        const rawUrl = stringArg(call.args.url, 'url', 'download_url')
        const url = new URL(rawUrl)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('download_url: only HTTP(S) URLs are allowed')
        }
        const response = await deps.fetchFn(url, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok) throw new Error(`download_url: HTTP ${response.status} for ${url}`)
        if (!response.body) throw new Error(`download_url: ${url} returned an empty body`)
        const declaredSize = Number(response.headers.get('content-length'))
        if (Number.isFinite(declaredSize) && declaredSize > maxDownloadBytes) {
          throw new Error(`download_url: file exceeds the ${maxDownloadBytes}-byte limit`)
        }

        const root = rootPath(deps.downloadsDir)
        const filename = filenameFrom(url, call.args.filename)
        const path = uniqueDownloadPath(root, filename, existsSync)
        let bytes = 0
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.byteLength
            callback(
              bytes > maxDownloadBytes
                ? new Error(`download_url: file exceeds the ${maxDownloadBytes}-byte limit`)
                : null,
              chunk,
            )
          },
        })
        const output = createWriteStream(path, { flags: 'wx' })
        let created = false
        output.once('open', () => {
          created = true
        })
        try {
          await pipeline(
            Readable.fromWeb(response.body as never),
            limiter,
            output,
          )
        } catch (error) {
          // `wx` can lose a same-name race. Only remove a partial file this
          // invocation actually created; never unlink the winner's file.
          if (created) await unlink(path).catch(() => undefined)
          throw error
        }
        return `downloaded ${filename} (${bytes} bytes) to ${path}`
      },
    },
    {
      name: 'list_downloads',
      description: 'List files and folders in the Bing Bong downloads directory.',
      async execute() {
        const root = rootPath(deps.downloadsDir)
        const entries = readdirSync(root, { withFileTypes: true })
          .map((entry) => `${entry.isDirectory() ? '[dir] ' : ''}${entry.name}`)
          .sort()
        return entries.length === 0 ? 'downloads directory is empty' : entries.join('\n')
      },
    },
    {
      name: 'move_download',
      description: 'Move or rename a file within the Bing Bong downloads directory.',
      parameters: {
        source: { type: 'string', description: 'Existing path relative to the downloads directory' },
        destination: { type: 'string', description: 'New path relative to the downloads directory' },
      },
      async execute(call) {
        const source = confinedPath(
          deps.downloadsDir,
          stringArg(call.args.source, 'source', 'move_download'),
          'move_download',
        )
        const destination = confinedPath(
          deps.downloadsDir,
          stringArg(call.args.destination, 'destination', 'move_download'),
          'move_download',
        )
        if (!existsSync(source)) throw new Error('move_download: source does not exist')
        if (existsSync(destination)) throw new Error('move_download: destination already exists')
        mkdirSync(dirname(destination), { recursive: true })
        renameSync(source, destination)
        return `moved ${source} to ${destination}`
      },
    },
  ]
}
