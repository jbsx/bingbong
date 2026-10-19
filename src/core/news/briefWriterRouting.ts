import type { ModelEndpointConfig } from '../decision/decisionRouting'

// The Story Brief writer's routing: GLM on Z.ai's coding plan, an
// OpenAI-compatible chat endpoint, by the owner's ruling (2026-10-19) —
// the News card is asynchronous, so it need not be Jev. As with the
// decision role, the key alone arms it; the base URL and the pinned model
// id default and are overridable. No key, and the card shows headlines
// with no briefs.

const WRITER_ENV_PREFIX = 'BINGBONG_NEWS_WRITER'
const WRITER_DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const WRITER_DEFAULT_MODEL = 'GLM-5.3'
const WRITER_DEFAULT_KEY_ENV = 'ZAI_API_KEY'

/** Every env var that configures the writer — what a hermetic harness unsets. */
export function briefWriterEnvKeys(): string[] {
  return [`${WRITER_ENV_PREFIX}_BASE_URL`, `${WRITER_ENV_PREFIX}_MODEL`, `${WRITER_ENV_PREFIX}_API_KEY`, `${WRITER_ENV_PREFIX}_API_KEY_ENV`, WRITER_DEFAULT_KEY_ENV]
}

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

/**
 * The writer's endpoint: the key from `BINGBONG_NEWS_WRITER_API_KEY`, the
 * env var named by `BINGBONG_NEWS_WRITER_API_KEY_ENV`, or `ZAI_API_KEY`;
 * null when none is set.
 */
export function resolveBriefWriterRouting(env: Record<string, string | undefined>): ModelEndpointConfig | null {
  const keyEnvName = readEnv(env, `${WRITER_ENV_PREFIX}_API_KEY_ENV`)
  // A named key env that is unset never falls back to the default key.
  const apiKey = readEnv(env, `${WRITER_ENV_PREFIX}_API_KEY`) ?? (keyEnvName ? readEnv(env, keyEnvName) : readEnv(env, WRITER_DEFAULT_KEY_ENV))
  if (!apiKey) return null
  return {
    baseUrl: (readEnv(env, `${WRITER_ENV_PREFIX}_BASE_URL`) ?? WRITER_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: readEnv(env, `${WRITER_ENV_PREFIX}_MODEL`) ?? WRITER_DEFAULT_MODEL,
    apiKey,
  }
}
