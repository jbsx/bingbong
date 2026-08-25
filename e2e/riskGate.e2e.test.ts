import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approveConfirmationScript } from './scripts'
import { startHarness, type Harness } from './harness'
import { startFixtureServer, type FixtureServer } from './fixtureServer'
import { waitFor } from './waitFor'
import { feedText } from './feed'
import type { AssistantTurn } from '../src/core/ports/llm'

// Risk gate e2e: real Electron app, real CDP pane, scripted LLM. The /risky
// fixture's DOM order fixes the refs: [2] password, [5] Pay now, [7] Send.
// Seam tests cover deny/approve/timeout with a fake clock; here we prove the
// gate holds through the real collector script, controller, IPC and dialog.

async function waitForTranscript(harness: Harness, expected: string): Promise<void> {
  await waitFor(
    async () => {
      const transcript = await feedText(harness)
      return transcript.includes(expected) ? transcript : undefined
    },
    { timeoutMs: 20000, intervalMs: 250 },
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
      await harness.submitCommand('log in and pay')
      await harness.waitForPaneUrl(fixture.url('/risky'))

      await waitFor(
        async () => {
          const text = await feedText(harness)
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
      await harness.submitCommand('send the contact form')

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

      await waitForTranscript(harness, 'The contact form was submitted.')
    } finally {
      await harness.quit()
    }
  })

  it('lets a cookie-consent submit through without pausing on the dialog', async () => {
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/consent') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'click', args: { ref: 1 } }] },
      { kind: 'answer', speak: 'Consent dismissed.', display: 'Cookie consent dismissed.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await harness.submitCommand('accept the cookies')
      await harness.waitForPaneUrl(fixture.url('/consent'))

      // The click submits the consent form — no confirmation ever requested.
      await waitFor(
        async () => {
          const title = await harness.paneEval<string>(`document.title`)
          return title === 'submitted:consent' ? title : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      const confirmationShown = await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)
      expect(confirmationShown).toBe(false)
      await waitForTranscript(harness, 'Cookie consent dismissed.')
    } finally {
      await harness.quit()
    }
  })

  it('runs a search-form submit AFK — no confirmation card on either submit path (#102, ADR 0015)', async () => {
    // /engine refs: [1] the q box (type=search, name=q) [2] the Search
    // button — a real <form method=get>, like Google/DDG/Bing. Path one:
    // trailing-newline type. Path two: clicking the submit control. Both
    // merely navigate, so neither may pause the run.
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/engine') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'type', args: { ref: 1, text: 'fixture widgets\n' } } ] },
      { kind: 'tool_calls', calls: [{ id: 'c3', name: 'navigate', args: { url: fixture.url('/engine') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c4', name: 'click', args: { ref: 2 } }] },
      { kind: 'answer', speak: 'Both searches ran hands-free.', display: 'Search submits are never confirmed.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await harness.submitCommand('search for fixture widgets twice')

      // The Enter submit landed on the results page…
      await waitFor(
        async () => {
          const url = await harness.paneEval<string>('location.href')
          return url.includes('/results?q=fixture') ? url : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )
      // …and the clicked submit navigated again with no dialog ever shown.
      await harness.waitForPaneUrl(fixture.url('/results?q='))
      const confirmationShown = await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)
      expect(confirmationShown).toBe(false)

      await waitForTranscript(harness, 'Search submits are never confirmed.')
    } finally {
      await harness.quit()
    }
  })

  it('exempts a site-local search box flavored only by its attributes (#102, ADR 0015)', async () => {
    // /site-search's box is name=query + "Search this site" placeholder —
    // no type=search — so the attribute clause alone must carry the
    // exemption, through the real collector script.
    const script: AssistantTurn[] = [
      { kind: 'tool_calls', calls: [{ id: 'c1', name: 'navigate', args: { url: fixture.url('/site-search') } }] },
      { kind: 'tool_calls', calls: [{ id: 'c2', name: 'type', args: { ref: 1, text: 'gadgets\n' } }] },
      { kind: 'answer', speak: 'Searched the site.', display: 'Site-local search ran without asking.' },
    ]
    const harness = await startHarness({ fixture, env: { BINGBONG_LLM_SCRIPT: JSON.stringify(script) } })
    try {
      await harness.submitCommand('search this site for gadgets')

      // The Enter submit ran: the fixture form recorded it in the title.
      await waitFor(
        async () => {
          const title = await harness.paneEval<string>(`document.title`)
          return title === 'submitted:sitesearch' ? title : undefined
        },
        { timeoutMs: 20000, intervalMs: 250 },
      )

      const confirmationShown = await harness.dashboardEval<boolean>(`!!document.querySelector('.confirmation-card')`)
      expect(confirmationShown).toBe(false)
      await waitForTranscript(harness, 'Site-local search ran without asking.')
    } finally {
      await harness.quit()
    }
  })
})
