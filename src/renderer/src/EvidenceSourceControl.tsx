import { useState } from 'react'
import type { MemoryReference } from '../../core/session/workingMemory'
import { sourceLabel } from '../../core/session/evidenceBrowser'

/**
 * The one shared evidence source control (#144, ADR 0028): a source's
 * human label — the retained page title, else the hostname — with the
 * URL as plain selectable text and a `Copy source` button that always
 * copies, never navigates. Inspecting evidence can never move the
 * visible browser, whether a Run is active or idle: the button holds no
 * navigation seam at all, unlike the ordinary Markdown links an Answer
 * authors, which keep their own behavior.
 *
 * Every activation reports beside the control: `Source copied` on
 * success, `Couldn't copy source` on failure, announced through the
 * status live region — a clipboard action never appears to do nothing,
 * and a failed one never hides the URL it could not copy.
 */

type CopyStatus = 'idle' | 'copied' | 'failed'

const STATUS_TEXT: Record<CopyStatus, string> = {
  idle: '',
  copied: 'Source copied',
  failed: "Couldn't copy source",
}

export function EvidenceSourceControl({ reference }: { reference: MemoryReference }) {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const copySource = (): void => {
    navigator.clipboard.writeText(reference.url).then(
      () => setStatus('copied'),
      () => setStatus('failed'),
    )
  }
  return (
    <span className="evidence-source-control">
      <span className="evidence-source-label">{sourceLabel(reference)}</span>
      <span className="evidence-source-url">{reference.url}</span>
      <button type="button" className="evidence-copy" onClick={copySource}>
        Copy source
      </button>
      {/* Always mounted so the announcement is a change in a live
          region, not a region appearing — and so the status sits beside
          the same control that produced it. */}
      <span className={`evidence-copy-status evidence-copy-status--${status}`} role="status">
        {STATUS_TEXT[status]}
      </span>
    </span>
  )
}
