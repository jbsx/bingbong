import { describe, expect, it } from 'vitest'
import { assessBrowserAction } from './riskGate'
import type { SnapshotRef } from '../browser/snapshot'
import type { ToolCall } from '../ports/llm'

function target(overrides: Partial<SnapshotRef> = {}): SnapshotRef {
  return {
    ref: 1,
    kind: 'button',
    label: 'A button',
    inputType: null,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    href: null,
    downloadsFile: false,
    submitsForm: false,
    credentialField: false,
    paymentField: false,
    inForm: false,
    formHasCredential: false,
    formHasPayment: false,
    ...overrides,
  }
}

function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: 'c1', name, args }
}

describe('assessBrowserAction', () => {
  it('allows when the ref no longer resolves — the tool fails on its own', () => {
    expect(assessBrowserAction(call('click', { ref: 9 }), undefined)).toEqual({ kind: 'allow' })
  })

  it('allows tools it does not classify', () => {
    expect(assessBrowserAction(call('navigate', { url: 'https://x.test' }), undefined)).toEqual({ kind: 'allow' })
    expect(assessBrowserAction(call('scroll', { direction: 'down' }), target())).toEqual({ kind: 'allow' })
  })

  describe('type', () => {
    it('hard-denies typing into credential fields', () => {
      const password = target({ kind: 'input', inputType: 'password', credentialField: true, inForm: true, formHasCredential: true })

      expect(assessBrowserAction(call('type', { ref: 1, text: 'hunter2' }), password)).toEqual({
        kind: 'deny',
        reason: 'credential fields are never filled by the agent — the user can type it themselves',
      })
    })

    it('hard-denies typing into payment fields', () => {
      const card = target({ kind: 'input', paymentField: true, inForm: true, formHasPayment: true })

      expect(assessBrowserAction(call('type', { ref: 1, text: '4242' }), card)).toEqual({
        kind: 'deny',
        reason: 'payment details are never filled by the agent',
      })
    })

    it('hard-denies submitting a payment form by pressing Enter', () => {
      const field = target({ kind: 'input', inForm: true, formHasPayment: true })

      expect(assessBrowserAction(call('type', { ref: 1, text: 'hi\n' }), field)).toEqual({
        kind: 'deny',
        reason: 'payments are never submitted by the agent',
      })
    })

    it('asks before submitting a login form by pressing Enter', () => {
      const field = target({ kind: 'input', inForm: true, formHasCredential: true })

      expect(assessBrowserAction(call('type', { ref: 1, text: 'alice\n' }), field)).toEqual({
        kind: 'confirm',
        prompt: 'Submit the login form?',
      })
    })

    it('asks before submitting any other form by pressing Enter', () => {
      const field = target({ kind: 'input', label: 'Your name', inForm: true })

      expect(assessBrowserAction(call('type', { ref: 1, text: 'bob\n' }), field)).toEqual({
        kind: 'confirm',
        prompt: 'Submit the form via "Your name"?',
      })
    })

    it('allows typing without Enter, even inside forms', () => {
      const field = target({ kind: 'input', inForm: true, formHasPayment: true })

      expect(assessBrowserAction(call('type', { ref: 1, text: 'bob' }), field)).toEqual({ kind: 'allow' })
    })

    it('allows Enter outside any form (search boxes)', () => {
      const search = target({ kind: 'input', inputType: 'search', label: 'Search' })

      expect(assessBrowserAction(call('type', { ref: 1, text: 'mkbhd\n' }), search)).toEqual({ kind: 'allow' })
    })
  })

  describe('click', () => {
    it('hard-denies clicking the submit control of a payment form', () => {
      const pay = target({ label: 'Pay now', submitsForm: true, inForm: true, formHasPayment: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), pay)).toEqual({
        kind: 'deny',
        reason: 'payments are never submitted by the agent',
      })
    })

    it('asks before submitting a login form', () => {
      const signIn = target({ label: 'Sign in', submitsForm: true, inForm: true, formHasCredential: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), signIn)).toEqual({
        kind: 'confirm',
        prompt: 'Submit the login form?',
      })
    })

    it('allows cookie-consent submits like the YouTube consent wall', () => {
      const accept = target({ label: 'Accept all', submitsForm: true, inForm: true })
      const reject = target({ label: 'Reject all', submitsForm: true, inForm: true })
      const withCookies = target({ label: 'Accept all cookies', submitsForm: true, inForm: true })
      const allowCookies = target({ label: 'Allow all cookies', submitsForm: true, inForm: true })
      // The collector joins aria-label and visible text: "Accept all" twice.
      const doubled = target({ label: 'Accept all Accept all', submitsForm: true, inForm: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), accept)).toEqual({ kind: 'allow' })
      expect(assessBrowserAction(call('click', { ref: 1 }), reject)).toEqual({ kind: 'allow' })
      expect(assessBrowserAction(call('click', { ref: 1 }), withCookies)).toEqual({ kind: 'allow' })
      expect(assessBrowserAction(call('click', { ref: 1 }), allowCookies)).toEqual({ kind: 'allow' })
      expect(assessBrowserAction(call('click', { ref: 1 }), doubled)).toEqual({ kind: 'allow' })
    })

    it('still confirms consent-labelled submits on credential forms', () => {
      const login = target({ label: 'Accept all', submitsForm: true, inForm: true, formHasCredential: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), login)).toEqual({
        kind: 'confirm',
        prompt: 'Submit the login form?',
      })
    })

    it('still confirms ordinary form submits that mention cookies in passing', () => {
      const send = target({ label: 'Send me cookies news', submitsForm: true, inForm: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), send)).toEqual({
        kind: 'confirm',
        prompt: 'Submit the form via "Send me cookies news"?',
      })
    })

    it('asks before submitting any other form', () => {
      const send = target({ label: 'Send', submitsForm: true, inForm: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), send)).toEqual({
        kind: 'confirm',
        prompt: 'Submit the form via "Send"?',
      })
    })

    it('asks before a download-attribute link, naming the file from the href', () => {
      const link = target({ kind: 'link', label: 'Download probe', href: 'http://x.test/dl/probe.bin', downloadsFile: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), link)).toEqual({
        kind: 'confirm',
        prompt: 'Download "probe.bin"?',
      })
    })

    it('asks before links to download-looking files even without the attribute', () => {
      const link = target({ kind: 'link', label: 'Get it', href: 'https://x.test/releases/app-1.0.dmg?src=web' })

      expect(assessBrowserAction(call('click', { ref: 1 }), link)).toEqual({
        kind: 'confirm',
        prompt: 'Download "app-1.0.dmg"?',
      })
    })

    it('falls back to the label when the filename cannot be derived', () => {
      const link = target({ kind: 'link', label: 'Save file', downloadsFile: true })

      expect(assessBrowserAction(call('click', { ref: 1 }), link)).toEqual({
        kind: 'confirm',
        prompt: 'Download "Save file"?',
      })
    })

    it('allows ordinary links, buttons and media', () => {
      expect(assessBrowserAction(call('click', { ref: 1 }), target({ kind: 'link', href: 'https://x.test/about' }))).toEqual({ kind: 'allow' })
      expect(assessBrowserAction(call('click', { ref: 1 }), target({ kind: 'button', label: 'Show all' }))).toEqual({ kind: 'allow' })
      expect(assessBrowserAction(call('click', { ref: 1 }), target({ kind: 'media', label: 'Player' }))).toEqual({ kind: 'allow' })
    })
  })
})
