import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approveConfirmationScript, commandBoxScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import type { AssistantTurn } from '../src/core/ports/llm'

// Risk gate e2e: real Electron app, real CDP pane, scripted LLM. The /risky
// fixture's DOM order fixes the refs: [2] password, [5] Pay now, [7] Send.
// Seam tests cover deny/approve/timeout with a fake clock; here we prove the
// gate holds through the real collector script, controller, IPC and dialog.

async function transcriptText(harness: Harness): Promise<string> {
  return harness.dashboardEval<string>(
    `Array.from(document.querySelectorAll('.transcript-entry')).map((el) => el.textContent).join('\\n')`,
  )
}

describe('risk gate e2e', () => {
  let fixture: FixtureServer

  beforeAll(async () => {
    fixture = await startFixtureServer()
  })

  afterAll(async () => {
    await fixture?.close()
  })

  it('hard-blocks credential fills and payment submits — even though a dialog would be approvable', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/risky') } }] },
      {
        kind: 'tool_calls',
        calls: [
          { id: 'c2', name: 'type', args: { ref: 2, text: 'hunter2' } },
          { id: 'c3', name: 'click', args: { ref: 5 } },
        ],
      },
      { kind: 'answer', speak: 'Both were blocked.', display: 'Credential fill and payment submit blocked.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await harness.dashboardEval<string>(commandBoxScript('log in and pay'))
      await harness.waitForPaneUrl(fixture.url('/risky'))

      await waitFor(
        async () => {
          const text = await transcriptText(harness)
          return text.includes('credential fields are never filled') && text.includes('payments are never submitted')
            ? text
            : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      // No confirmation dialog ever appeared for hard-denied calls…
      const confirmationShown = await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)
      expect(confirmationShown).toBe(false)

      // …the password field stayed empty and no form was submitted.
      const passValue = await harness.paneEval<string>(`document.getElementById('pass').value`)
      expect(passValue).toBe('')
      const title = await harness.paneEval<string>(`document.title`)
      expect(title).toBe('risky fixture')
    } finally {
      await harness.quit()
    }
  })

  it('pauses a form submission on the dialog and submits once approved', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/risky') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: { ref: 7 } }] },
      { kind: 'answer', speak: 'Form sent.', display: 'The contact form was submitted.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await harness.dashboardEval<string>(commandBoxScript('send the contact form'))

      // The dialog appears with the gate's prompt…
      await waitFor(
        async () => {
          const prompt = await harness.dashboardEval<string>(
            `document.querySelector('.confirmation-prompt')?.textContent ?? ''`,
          )
          return prompt === '' ? undefined : prompt
        },
        { timeoutMs: 20000, intervalMs: 250 },
      ).then((prompt) => {
        expect(prompt).toBe('Submit the form via "Send"?')
      })

      // …the form is not submitted while the dialog is open…
      const titleBefore = await harness.paneEval<string>(`document.title`)
      expect(titleBefore).toBe('risky fixture')

      // …and approving through the real dialog button lets the click through.
      const approved = await harness.dashboardEval<string>(approveConfirmationScript())
      expect(approved).toBe('approved')
      await waitFor(
        async () => {
          const title = await harness.paneEval<string>(`document.title`)
          return title === 'submitted:contact' ? title : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      const transcript = await transcriptText(harness)
      expect(transcript).toContain('Form sent.')
    } finally {
      await harness.quit()
    }
  })
})
