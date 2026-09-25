import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import { readRunEngine, webEngineSearchOf, type WebEngine } from './webEngine'

// #270, ADR 0066: the Engine Rewrite. The model chose its engine per search —
// DuckDuckGo mostly, Bing now and then, Google four times across three
// captures, and Google walled all four (a Challenge on every `/search`). The
// engine was a variable no capture held fixed, and the Composed Address and
// Unseen Phrase rewrites inherited whatever the model last typed.
//
// A sibling of the ADR 0055 and ADR 0064 rewrites and first in their chain:
// a navigate to a Web Engine's Search URL other than the Run Engine's runs
// as the Run Engine's search with the same terms, and the outcome's first
// line says so. Plain terms are the DuckDuckGo search the browser composes,
// so they move too when the user named another engine. A site's own search
// is no Web Engine search and passes untouched; so does an engine's home
// page — a typed search into its box is never observed (decision 6).
//
// The Run Engine is read per call through one seam, so a Steering directive
// naming an engine counts from the next search. Nothing is refused, nothing
// is observed, nothing ends a Run. Fresh per executor like every rail.

export interface EngineRewriteRailDeps {
  /** The Run Engine, read at every search. Absent, or throwing, DuckDuckGo. */
  runEngine?: () => WebEngine
}

/** A search on another Web Engine, as the Run Engine's search it runs as instead. */
export interface EngineRewrite {
  /** The engine the model searched on. */
  readonly from: WebEngine
  /** The Run Engine the search ran on. */
  readonly to: WebEngine
  /** The terms, as the model wrote them. */
  readonly query: string
  /** The call that executes: the model's own id and name, navigating to the Run Engine's Search URL. */
  readonly call: ToolCall
}

/**
 * What a rewrite is recorded as: the Tool Round stamps it on the call's
 * `tool_result` event beside the other rewrite stamps, so the Run Trace and
 * the Round Audit read it from the pipeline's own field, never from the
 * wording of the line below.
 */
export interface EngineRewriteStamp {
  readonly from: string
  readonly to: string
  readonly query: string
}

export interface EngineRewriteRail {
  /** The Run Engine search a search on another Web Engine runs as; null for every other call. */
  rewrite(call: ToolCall): EngineRewrite | null
}

/** The line a rewritten call's result opens with, in ADR 0055's form: what ran where, and why. */
export function engineRewriteLine(rewrite: EngineRewrite): string {
  return (
    `Rewritten — this run searches on ${rewrite.to.label}, so the ${rewrite.from.label} search ran there with the same terms: ${JSON.stringify(rewrite.query)}. ` +
    `Search with plain terms or a ${rewrite.to.label} address.`
  )
}

/** The outcome the model reads for a rewritten call: the line, then the search's own outcome, failed or not. */
export function withEngineRewrite(outcome: ToolResultOutcome, rewrite: EngineRewrite): ToolResultOutcome {
  const line = engineRewriteLine(rewrite)
  if (!outcome.ok) return { ok: false, error: `${line}\n${outcome.error}` }
  return typeof outcome.result === 'string' ? { ok: true, result: `${line}\n${outcome.result}` } : outcome
}

export function createEngineRewriteRail(deps: EngineRewriteRailDeps = {}): EngineRewriteRail {
  const runEngine = (): WebEngine => readRunEngine(deps.runEngine, 'pipeline.engineRewriteRail.runEngine')

  return {
    rewrite(call) {
      if (call.name !== 'navigate' || typeof call.args.url !== 'string') return null
      const search = webEngineSearchOf(call.args.url)
      if (search === null) return null
      const to = runEngine()
      if (search.engine.name === to.name) return null
      return { from: search.engine, to, query: search.query, call: { ...call, args: { ...call.args, url: to.searchUrl(search.query) } } }
    },
  }
}
