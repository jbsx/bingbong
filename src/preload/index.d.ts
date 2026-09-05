import type { BrowserPaneState, PaneRect } from '../core/browser/paneState'
import type { PipelineEvent } from '../core/pipeline/events'
import type { AppSettings } from '../core/settings/settings'
import type { RoutingStatus } from '../core/agent/modelRouting'
import type { VoiceErrorEvent, VoiceHeardEvent, VoiceState } from '../core/voice/ipcChannels'
import type { LaunchConfig } from '../core/app/launchConfig'
import type { UsageSummary } from '../core/agent/spendEstimate'
import type { FeedPanelMode, FeedPanelState } from '../core/panel/feedPanelState'
import type { SubmissionFeedback } from '../core/session/submissionFeedback'
import type { SessionAdoptionPayload, SessionDecisionRequest } from '../core/session/ipcChannels'
import type { SessionEvidenceChangePayload, SessionEvidencePayload } from '../core/session/evidenceIpcChannels'
import type { EvidenceBrowserView } from '../core/session/evidenceBrowserView'
import type { RendererReport } from '../core/trace/rendererTrace'

export type { BrowserPaneState, PaneRect }
export type { PipelineEvent }
export type { AppSettings }
export type { RoutingStatus }
export type { VoiceErrorEvent, VoiceHeardEvent, VoiceState }
export type { LaunchConfig }
export type { UsageSummary }
export type { RecordedEntry, RunRecord, SessionRecord }
export type { SubmissionFeedback }
export type { SessionEvidenceChangePayload, SessionEvidencePayload }
export type { EvidenceBrowserView }
export type { RendererReport }
export interface BingbongBrowserApi {
  navigate(input: string): Promise<boolean>
  goBack(): Promise<void>
  goForward(): Promise<void>
  getState(): Promise<BrowserPaneState>
  reportPaneRect(rect: PaneRect): void
  onState(listener: (state: BrowserPaneState) => void): () => void
}

export interface BingbongAssistantApi {
  submit(text: string): Promise<boolean>
  resolveConfirmation(confirmationId: string, approved: boolean): Promise<void>
  /** Answer an open ask_user window with free text (the dashboard card). */
  resolveAsk(askId: string, answer: string): Promise<void>
  /** Abort the active run; false means there was no run to stop. */
  abort(): Promise<boolean>
  /**
   * Steer the active run from the feed panel's box (#46) — the same seam
   * as spoken steering. False means nothing was taken.
   */
  steer(directive: string): Promise<boolean>
  onEvent(listener: (event: PipelineEvent) => void): () => void
  /** Non-Run feedback for a Submission rejected before admission. */
  onSubmissionFeedback(listener: (feedback: SubmissionFeedback) => void): () => void
}

export interface BingbongSettingsApi {
  get(): Promise<AppSettings>
  update(settings: AppSettings): Promise<AppSettings>
  onChanged(listener: (settings: AppSettings) => void): () => void
  /** Which agent roles resolve right now — the routing status lines (#76). */
  routingStatus(): Promise<RoutingStatus>
  onRoutingStatusChanged(listener: (status: RoutingStatus) => void): () => void
}

export interface BingbongSessionApi {
  extend(request: SessionDecisionRequest): Promise<boolean>
  decline(request: SessionDecisionRequest): Promise<boolean>
  /** The live Session's identity, or null — a reloaded page re-adopts from it (ADR 0017). */
  current(): Promise<SessionAdoptionPayload | null>
  /** Main's re-send of the live Session identity on a late page load (ADR 0017). */
  onReadopt(listener: (identity: SessionAdoptionPayload) => void): () => void
}

export interface BingbongEvidenceApi {
  /**
   * The live Session's complete Evidence snapshot — observations and
   * candidates — stamped with Session identity and generation; null when
   * no Session is open (#139). The authoritative read the Evidence
   * Browser renders and re-reads on every change notification.
   */
  get(): Promise<SessionEvidencePayload | null>
  /**
   * An accepted Observation change: identity and generation only — the
   * response is to re-read `get()` (#139).
   */
  onChanged(listener: (change: SessionEvidenceChangePayload) => void): () => void
  /** The Session-owned selected Activity/Evidence view (#145). */
  getView(): Promise<EvidenceBrowserView | null>
  /** Select the Activity/Evidence view (#145) — Session-ephemeral, never persisted. */
  setView(view: EvidenceBrowserView): void
  /** The selected view changed — Session boundaries return it to Activity (#145). */
  onViewChanged(listener: (payload: { view: EvidenceBrowserView }) => void): () => void
}

export interface BingbongSubagentsApi {
  /** Report a live tab viewport's rect (drives the WebContentsView bounds). */
  reportTabRect(agentId: string, rect: PaneRect): void
  /** Reopen a closed subagent tab from its retained card. */
  reopenTab(agentId: string): Promise<boolean>
  /** Cancel a running subagent (the card's Cancel button). */
  cancel(agentId: string): Promise<boolean>
}

export interface BingbongUsageApi {
  /** Today's spend estimate (warn-only) for the settings page. */
  getToday(): Promise<UsageSummary>
}

export interface BingbongTtsApi {
  /** Installed piper voice ids, for the settings picker. */
  listVoices(): Promise<string[]>
}

export interface BingbongLearnedTermsApi {
  /** The admitted Learned Terms, admission order (ADR 0022). */
  list(): Promise<readonly string[]>
  /** Add one directly; false when invalid or already seed vocabulary. */
  add(term: string): Promise<boolean>
  /** Remove one and plant a rejection auto-proposals cannot cross. */
  remove(term: string): Promise<boolean>
  /** The admitted list changed (auto-admission or a manual edit). */
  onChanged(listener: (terms: readonly string[]) => void): () => void
}

export interface BingbongVoiceApi {
  arm(): Promise<void>
  disarm(): Promise<void>
  /** One chunk of mono 16 kHz PCM from the mic worklet (multiple of 512 samples). */
  sendAudio(chunk: Float32Array): void
  /** Current voice state — pulled on mount since events can predate the renderer. */
  getState(): Promise<VoiceState>
  onState(listener: (state: VoiceState) => void): () => void
  onHeard(listener: (heard: VoiceHeardEvent) => void): () => void
  onError(listener: (error: VoiceErrorEvent) => void): () => void
}

export interface BingbongDiagnosticsApi {
  /**
   * Report one thing this page did, for the Host Trace (#187, ADR 0031).
   * Fire-and-forget by design: main rebuilds the record from declared
   * fields and drops it entirely unless `BINGBONG_HOST_TRACE=1`, so a
   * page must never wait on — or branch on — its own diagnostics.
   */
  report(event: RendererReport): void
}

export interface BingbongFeedPanelApi {
  /** The current folded state — pulled on mount; changes arrive via onState. */
  getState(): Promise<FeedPanelState | null>
  /** Switch overlay/docked layout mode (persisted by the dashboard). */
  setMode(mode: FeedPanelMode): void
  /** Set the panel width in px — main clamps to [320, 75% of window]. */
  setWidth(width: number): void
  /** A width drag started: cloak the view so the overlay tracks the pointer window-wide. */
  beginResize(): void
  /** The width drag ended: restore the view bounds from the folded width. */
  endResize(): void
  /** Flip the peaked/collapsed state (header button, shortcut, edge tab). */
  toggle(): void
  /** Report the panel slot's rect — drives the native overlay view's bounds. */
  reportRect(rect: PaneRect): void
  onState(listener: (state: FeedPanelState) => void): () => void
}

export interface BingbongApi {
  version: string
  /** Launch flags/env snapshot (kiosk mode, idle timeout). */
  app: LaunchConfig
  browser: BingbongBrowserApi
  assistant: BingbongAssistantApi
  session: BingbongSessionApi
  evidence: BingbongEvidenceApi
  settings: BingbongSettingsApi
  subagents: BingbongSubagentsApi
  usage: BingbongUsageApi
  tts: BingbongTtsApi
  learnedTerms: BingbongLearnedTermsApi
  voice: BingbongVoiceApi
  diagnostics: BingbongDiagnosticsApi
  feedPanel: BingbongFeedPanelApi
}

declare global {
  interface Window {
    bingbong: BingbongApi
  }
}

export {}
