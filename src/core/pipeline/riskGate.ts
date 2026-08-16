import type { SnapshotRef } from '../browser/snapshot'
import type { ToolCall } from '../ports/llm'
import type { RiskVerdict } from './tool'

// The risk gate's policy, as a pure function over snapshot facts (collected
// in-page). Hard rules — credential fills and payment submissions — deny
// outright; form submissions and downloads ask the user first. Prompts are
// worded so they can be both spoken and shown in the dialog.

const DENY_CREDENTIAL_FILL = 'credential fields are never filled by the agent — the user can type it themselves'
const DENY_PAYMENT_FILL = 'payment details are never filled by the agent'
const DENY_PAYMENT_SUBMIT = 'payments are never submitted by the agent'

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

export function assessBrowserAction(call: ToolCall, target: SnapshotRef | undefined): RiskVerdict {
  // An unresolvable ref fails inside the tool with a clear error; there is
  // nothing to gate.
  if (!target) return { kind: 'allow' }

  if (call.name === 'type') {
    if (target.credentialField) return { kind: 'deny', reason: DENY_CREDENTIAL_FILL }
    if (target.paymentField) return { kind: 'deny', reason: DENY_PAYMENT_FILL }
    if (submitsByEnter(call)) {
      if (target.formHasPayment) return { kind: 'deny', reason: DENY_PAYMENT_SUBMIT }
      if (target.inForm) return { kind: 'confirm', prompt: submitPrompt(target) }
    }
    return { kind: 'allow' }
  }

  if (call.name === 'click') {
    if (target.submitsForm) {
      if (target.formHasPayment) return { kind: 'deny', reason: DENY_PAYMENT_SUBMIT }
      return { kind: 'confirm', prompt: submitPrompt(target) }
    }
    if (target.downloadsFile || hrefEndsWithDownload(target.href)) {
      const name = downloadTargetName(target)
      return { kind: 'confirm', prompt: name ? `Download "${name}"?` : 'Download this file?' }
    }
  }

  return { kind: 'allow' }
}
