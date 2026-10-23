import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startHarness, type Harness } from './harness'
import { waitFor } from './waitFor'

// The Settings page's Environment section: the `.env`'s keys listed, a
// secret by its tail only, and a change, an addition and a removal each
// written straight to the file with its comments kept.

const SEEDED = ['# The Decision Model', 'ZAI_API_KEY=sk-secret-0123456789wxyz', 'BINGBONG_DECISION_TIMEOUT_MS=800', '# BINGBONG_DECISION_IMAGES=true', 'BINGBONG_SHADOWED=from-file', ''].join('\n')

function setInputScript(label: string, value: string): string {
  return `(() => {
    const input = document.querySelector('section[aria-label="environment"] input[aria-label=${JSON.stringify(label)}]')
    if (!input) return 'no-input'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`
}

function clickInRowScript(label: string, button: string): string {
  return `(() => {
    const input = document.querySelector('section[aria-label="environment"] input[aria-label=${JSON.stringify(label)}]')
    const target = [...input.closest('.settings-env-row').querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(button)})
    if (!target) return 'no-button'
    target.click()
    return 'clicked'
  })()`
}

describe('settings environment e2e', () => {
  let harness: Harness
  let userDataDir: string
  let envFile: string

  const fileText = (): Promise<string> => readFile(envFile, 'utf8')
  const waitForFile = (holds: (text: string) => boolean): Promise<string> =>
    waitFor(async () => {
      const text = await fileText()
      return holds(text) ? text : undefined
    }, { timeoutMs: 10000, intervalMs: 100 })

  beforeAll(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'bingbong-e2e-settings-env-'))
    envFile = join(userDataDir, 'app.env')
    await writeFile(envFile, SEEDED, 'utf8')
    harness = await startHarness({ userDataDir, env: { BINGBONG_ENV_FILE: envFile, BINGBONG_SHADOWED: 'from-process' } })
    await harness.clickDashboardElement('.settings-toggle')
    await waitFor(async () => ((await harness.dashboardEval<boolean>(`!!document.querySelector('section[aria-label="environment"]')`)) ? true : undefined), { timeoutMs: 10000, intervalMs: 250 })
    await harness.dashboardEval(`(() => { const details = document.querySelector('section[aria-label="environment"] details'); if (!details.open) details.open = true })()`)
  })

  afterAll(async () => {
    await harness?.quit()
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  it('lists the file, a secret by its last four characters only', async () => {
    const shown = await waitFor(
      async () => {
        const rows = await harness.dashboardEval<{ key: string; type: string; value: string; placeholder: string }[]>(
          `[...document.querySelectorAll('section[aria-label="environment"] .settings-field')].map((field) => { const input = field.querySelector('input'); return { key: field.querySelector('.settings-label').textContent, type: input.type, value: input.value, placeholder: input.placeholder } })`,
        )
        return rows.length >= 3 ? rows : undefined
      },
      { timeoutMs: 10000, intervalMs: 250 },
    )
    expect(shown.map((row) => row.key)).toEqual(['ZAI_API_KEY', 'BINGBONG_DECISION_TIMEOUT_MS', 'BINGBONG_SHADOWED', 'Add a key'])
    expect(shown[0]).toMatchObject({ type: 'password', value: '' })
    expect(shown[0]!.placeholder).toContain('wxyz')
    expect(shown[1]).toMatchObject({ type: 'text', value: '800' })
    const text = await harness.dashboardEval<string>(`document.querySelector('section[aria-label="environment"]').textContent`)
    expect(text).not.toContain('sk-secret')
    expect(text).toContain('BINGBONG_SHADOWED set in its environment')
    expect(text).toContain(envFile)
  })

  it('writes a change, an addition and a removal to the file, comments kept', async () => {
    expect(await harness.dashboardEval<string>(setInputScript('BINGBONG_DECISION_TIMEOUT_MS', '1500'))).toBe('typed')
    expect(await harness.dashboardEval<string>(clickInRowScript('BINGBONG_DECISION_TIMEOUT_MS', 'Save'))).toBe('clicked')
    await waitForFile((text) => text.includes('BINGBONG_DECISION_TIMEOUT_MS=1500'))

    expect(await harness.dashboardEval<string>(setInputScript('ZAI_API_KEY', 'sk-new-key-abcdefgh'))).toBe('typed')
    expect(await harness.dashboardEval<string>(clickInRowScript('ZAI_API_KEY', 'Save'))).toBe('clicked')
    await waitForFile((text) => text.includes('ZAI_API_KEY=sk-new-key-abcdefgh'))

    expect(await harness.dashboardEval<string>(setInputScript('New key name', 'BINGBONG_DECISION_MODEL'))).toBe('typed')
    expect(await harness.dashboardEval<string>(setInputScript('New key value', 'jev two'))).toBe('typed')
    expect(await harness.dashboardEval<string>(clickInRowScript('New key name', 'Add'))).toBe('clicked')
    await waitForFile((text) => text.includes('BINGBONG_DECISION_MODEL="jev two"'))

    expect(await harness.dashboardEval<string>(clickInRowScript('BINGBONG_SHADOWED', 'Remove'))).toBe('clicked')
    const text = await waitForFile((content) => !content.includes('BINGBONG_SHADOWED'))
    expect(text).toBe(['# The Decision Model', 'ZAI_API_KEY=sk-new-key-abcdefgh', 'BINGBONG_DECISION_TIMEOUT_MS=1500', '# BINGBONG_DECISION_IMAGES=true', 'BINGBONG_DECISION_MODEL="jev two"', ''].join('\n'))

    // The page follows the file: the added key is listed, the removed one gone.
    const keys = await waitFor(
      async () => {
        const found = await harness.dashboardEval<string[]>(`[...document.querySelectorAll('section[aria-label="environment"] .settings-label')].map((label) => label.textContent)`)
        return found.includes('BINGBONG_DECISION_MODEL') ? found : undefined
      },
      { timeoutMs: 5000, intervalMs: 100 },
    )
    expect(keys).not.toContain('BINGBONG_SHADOWED')
  })
})
