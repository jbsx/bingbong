import type { SnapshotRef } from '../browser/snapshot'
import { CONSENT_LABEL_RE } from '../browser/dialogPolicy'
import type { ToolCall } from '../ports/llm'
import type { RiskVerdict } from './tool'

// The risk gate's policy, as a pure function over snapshot facts (collected
// in-page). Hard rules — credential fills and payment submissions — deny
// outright; form submissions and downloads ask the user first. Search submits
// merely navigate (ADR 0015), so both of their paths — a trailing-newline type
// into a search-flavored field and a click on a search form's submit control —
// run without asking. Prompts are worded so they can be both spoken and shown
// in the dialog.

const DENY_CREDENTIAL_FILL = 'credential fields are never filled by the agent — the user can type it themselves'
const DENY_PAYMENT_FILL = 'payment details are never filled by the agent'
const DENY_PAYMENT_SUBMIT = 'payments are never submitted by the agent'

// Cookie-consent dialogs (e.g. the YouTube consent wall) submit button-only
// forms whose labels are a consent choice ("Accept all", "Reject all",
// "Allow all cookies"). Submitting one stores a cookie — no user data — so it
// is allowed without pausing. The label pattern lives in
// core/browser/dialogPolicy.ts (shared with the Tier-1 auto-dismissal).
const CONSENT_SUBMIT_LABEL_RE = CONSENT_LABEL_RE

const DOWNLOAD_EXTENSIONS = new Set([
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'iso', 'bin',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv',
  'mp3', 'wav', 'flac', 'mp4', 'mkv', 'mov', 'avi', 'webm',
])

function hrefEndsWithDownload(href: string | null): boolean {
  if (!href) return false
  const match = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(href)
  return match ? DOWNLOAD_EXTENSIONS.has(match[1].toLowerCase()) : false
}

function downloadTargetName(target: SnapshotRef): string | null {
  if (target.href) {
    const basename = target.href.split(/[?#]/)[0].split('/').filter(Boolean).pop()
    if (basename) return basename
  }
  return target.label || null
}

function submitPrompt(target: SnapshotRef): string {
  if (target.formHasCredential) return 'Submit the login form?'
  return target.label ? `Submit the form via "${target.label}"?` : 'Submit the form?'
}

function submitsByEnter(call: ToolCall): boolean {
  const text = call.args.text
  return typeof text === 'string' && /[\n\r]$/.test(text)
}

// ADR 0015: a search submit merely navigates and is never Consequential. The
// exemption is structural — the *submitted* field is search-flavored — never
// an allowlist, and stays behind the payment/credential hard rules so hybrid
// forms keep their gate.
export function assessBrowserAction(call: ToolCall, target: SnapshotRef | undefined): RiskVerdict {
  // An unresolvable ref fails inside the tool with a clear error; there is
  // nothing to gate.
  if (!target) return { kind: 'allow' }

  if (call.name === 'type') {
    if (target.credentialField) return { kind: 'deny', reason: DENY_CREDENTIAL_FILL }
    if (target.paymentField) return { kind: 'deny', reason: DENY_PAYMENT_FILL }
    if (submitsByEnter(call)) {
      if (target.formHasPayment) return { kind: 'deny', reason: DENY_PAYMENT_SUBMIT }
      // Enter submits from the field itself: its own flavor decides.
      if (target.searchField && !target.formHasCredential) return { kind: 'allow' }
      if (target.inForm) return { kind: 'confirm', prompt: submitPrompt(target) }
    }
    return { kind: 'allow' }
  }

  if (call.name === 'click') {
    if (target.submitsForm) {
      if (target.formHasPayment) return { kind: 'deny', reason: DENY_PAYMENT_SUBMIT }
      // Clicking submits the whole form: a search-flavored field in it
      // exempts the submit, exactly like a consent-labelled button.
      if (!target.formHasCredential && (CONSENT_SUBMIT_LABEL_RE.test(target.label) || target.formHasSearch)) {
        return { kind: 'allow' }
      }
      return { kind: 'confirm', prompt: submitPrompt(target) }
    }
    if (target.downloadsFile || hrefEndsWithDownload(target.href)) {
      const name = downloadTargetName(target)
      return { kind: 'confirm', prompt: name ? `Download "${name}"?` : 'Download this file?' }
    }
  }

  return { kind: 'allow' }
}
