import { reportFault } from '../trace/fault'
import { canonicalizeMemoryUrl } from '../session/workingMemory'

// Issue #273, ADR 0065: the Delegated Page Notice. A page a Browse Subagent
// of this Run was sent to or has landed on still loads — the On-Screen
// Principle and the ledger are untouched — but the Action Outcome of a call
// on it names the Subagent that holds it and what that holder's state means
// for the read: its report will carry the page, its report is waiting, or
// its report already states these findings from it.
//
// A sibling of the Held Page Notice (ADR 0051) on a different predicate and
// a different firing rule: once per page, holder and state, per executor,
// on any successful page-facing call — not once per landing — so a Run
// already on a page when a Subagent is sent there still hears of it, and a
// holder's state change on a page the Run stays on is heard too.

/** Where a Delegated Page's holder is: working, finished with its report uncollected, or collected. */
export type DelegatedPageState = 'running' | 'finished' | 'collected'

/** One finding of a collected report, as the Notice restates it. */
export interface DelegatedFinding {
  readonly subject: string
  readonly detail: string
}

/** A Browse Subagent holding one Delegated Page, and what the Notice says of it. */
export interface DelegatedHolder {
  readonly agentId: string
  /** The agent_results label of its kind — `browsing`. */
  readonly kindLabel: string
  readonly task: string
  readonly state: DelegatedPageState
  /** The collected report's findings citing this page; empty in the other states. */
  readonly findings: readonly DelegatedFinding[]
}

/**
 * The holders of one page, by any URL of it (the registry canonicalises).
 * Cancelled and failed Subagents are released and never returned; a
 * Subagent's own lookup excludes its own pages and returns running siblings
 * only.
 */
export type DelegatedPagesLookup = (url: string) => readonly DelegatedHolder[]

/** How many of the task's characters the running Notice quotes. */
export const DELEGATED_PAGE_TASK_CHARS = 160

/** How many collected findings one Notice lists before counting the rest. */
export const DELEGATED_PAGE_NOTICE_FINDINGS = 8

/** The fixed sentence a collected holder's Notice ends on. */
export const DELEGATED_PAGE_COLLECTED_INSTRUCTION =
  'Record these from the report rather than re-reading them, and read this page only for what they do not state.'

// The one reader of addresses in a spawn's free-text task — the Composed
// Address rail's offered addresses (#239) and the pages a Subagent was sent
// to both read through it.
const TASK_URL_RE = /https?:\/\/[^\s"'<>)\]]+/g
const CLOSING_PUNCTUATION_RE = /[.,;:!?]+$/

/** Every web address a spawn's task names, in order, a sentence's closing punctuation left off. */
export function urlsInTask(task: string): string[] {
  return (task.match(TASK_URL_RE) ?? []).map((url) => url.replace(CLOSING_PUNCTUATION_RE, ''))
}

function quotedTask(task: string): string {
  const flat = task.replace(/\s+/g, ' ').trim()
  return flat.length > DELEGATED_PAGE_TASK_CHARS ? `${flat.slice(0, DELEGATED_PAGE_TASK_CHARS)}…` : flat
}

function holderLines(holder: DelegatedHolder): string[] {
  switch (holder.state) {
    case 'running':
      return [
        `${holder.agentId} [${holder.kindLabel}] was sent to this page for: ${quotedTask(holder.task)}. Its report will carry what it reads here; keep to what you did not delegate, or wait with agent_results.`,
      ]
    case 'finished':
      return [`${holder.agentId} has finished with this page; collect its report with agent_results before reading it.`]
    case 'collected': {
      // A report citing nothing from the page covers none of it: the page is
      // the Run's to read, and a Notice would only say so at a round's cost.
      if (holder.findings.length === 0) return []
      const listed = holder.findings.slice(0, DELEGATED_PAGE_NOTICE_FINDINGS)
      const rest = holder.findings.length - listed.length
      return [
        `${holder.agentId}'s report already covers this page:`,
        ...listed.map((finding) => `- ${finding.subject}: ${finding.detail}`),
        ...(rest > 0 ? [`and ${rest} more in its report.`] : []),
        DELEGATED_PAGE_COLLECTED_INSTRUCTION,
      ]
    }
  }
}

/** The Notice a call on a Delegated Page carries: each holder by its state. Null when none has anything to say. */
export function delegatedPageNotice(holders: readonly DelegatedHolder[]): string | null {
  const lines = holders.flatMap(holderLines)
  return lines.length === 0 ? null : lines.join('\n')
}

export interface DelegatedPageNotices {
  /**
   * The Notice a successful page-facing call on this page carries: every
   * holder not yet announced in its current state on this page. Null when
   * there is none, when the page is not a web address, or when the lookup
   * throws — advisory, so a registry fault loses the Notice, never the call.
   */
  onPage(url: string | null): string | null
}

/** One executor's firing record: once per page, holder and state. */
export function createDelegatedPageNotices(lookup: DelegatedPagesLookup): DelegatedPageNotices {
  const announced = new Set<string>()
  return {
    onPage(url) {
      const page = url === null ? null : canonicalizeMemoryUrl(url)
      if (page === null) return null
      let holders: readonly DelegatedHolder[]
      try {
        holders = lookup(page)
      } catch (error) {
        reportFault('pipeline.delegatedPage.lookup', error)
        return null
      }
      const fresh = holders.filter((holder) => !announced.has(`${page}|${holder.agentId}|${holder.state}`))
      for (const holder of fresh) announced.add(`${page}|${holder.agentId}|${holder.state}`)
      return delegatedPageNotice(fresh)
    },
  }
}
