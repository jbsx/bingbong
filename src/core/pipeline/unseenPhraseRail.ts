import type { ToolCall, ToolResultOutcome } from '../ports/llm'
import type { SnapshotRef } from '../browser/snapshot'
import type { ObservationRecord } from '../session/observationLedger'
import { normalizeUrlInput, parseSearchUrl, searchUrl } from '../browser/urlInput'
import { isSearchInputRef, refNumberOf } from './progressFingerprints'
import { reportFault } from '../trace/fault'

// #267, ADR 0064: the Unseen Phrase rail. An exact-phrase search is a strong
// tool when the phrase is real, and the Run has one way to know a phrase is
// real: it was shown it. Voyager's searches quoted titles the model invented
// — `"Voyager 1 Has Not Yet Left the Solar System"` — and an exact-phrase
// search for a phrase no page carries returns noise, round after round. The
// Search Loop rail (ADR 0058) counts those rounds; it never touches the
// terms, and the terms are the mechanism.
//
// A sibling of the Composed Address rewrite (ADR 0055): a gate that
// transforms a search's terms before the call runs and says so in the
// outcome's first line. Every `"…"` span in a search's terms — a navigate to
// a Search URL by any of its forms (ADR 0059), bare terms, or text typed
// into a search box — is matched against what the Run has been shown. A
// span found anywhere keeps its quotes; one found nowhere loses them, and
// the words stay. Nothing is refused and the search runs.
//
// Sight is the Run's own, read from its Observation ledger through one seam
// per call, every record included — failed outcomes too, since the model
// read them — plus whatever the caller puts ahead of the ledger (a worker's
// brief). The user's command is in the ledger, so a phrase quoted from the
// user's own words is never unseen.
//
// A Search Echo is not sight: a results page repeats the Run's own terms in
// its title and in the search box's value (the e2e fixture engine in its
// heading too), so without this the phrase would count as shown the round
// after it was first searched and the gate would refuse it exactly once. On
// a shown text whose source is a Search URL, a line carrying the query in
// full is an echo, and so is a title, header or `value=` line carrying any
// quoted span of it — an engine may print the query cut or without its
// quotes. A result's own line is never an echo unless it repeats the whole
// query, the one edge ADR 0064's note accepts: a lone quoted phrase a
// snippet repeats is dropped with the echoes, and the way through is to
// open the result, which the outcome asks for anyway.
//
// The gate's own head never reaches the ledger — the Tool Round records the
// raw outcome before any rewrite line is attached — so nothing here has to
// exclude it. Fresh per executor like every rail.

/** One text the Run was shown, with the page it came from when it came from one. */
export interface ShownText {
  readonly text: string
  readonly sourceUrl?: string
}

/**
 * The ledger's records as shown texts (#267): every record, failed outcomes
 * included, its payload as the model read it — a structured payload as its
 * JSON, since that is the text the model was handed.
 */
export function shownTextsOf(records: readonly ObservationRecord[]): ShownText[] {
  return records.map((record) => ({
    text: typeof record.payload === 'string' ? record.payload : (JSON.stringify(record.payload) ?? ''),
    ...(record.sourceUrl !== undefined ? { sourceUrl: record.sourceUrl } : {}),
  }))
}

export interface UnseenPhraseRailDeps {
  /**
   * Everything this Run has been shown, read at every search so a page read
   * one call ago counts: the ledger's records, and whatever the caller puts
   * ahead of them. A seam that throws shows nothing.
   */
  shownTexts: () => readonly ShownText[]
  /** Snapshot ref facts: how a typed search is told from other typing (#82). */
  describeRef?(ref: number): Promise<SnapshotRef | undefined>
}

/** A search with Unseen Phrases, as the search it runs as instead. */
export interface UnseenPhraseRewrite {
  /** The spans that lost their quotes, as the model wrote them, in order. */
  readonly phrases: readonly string[]
  /** The terms that ran. */
  readonly query: string
  /** The call that executes: the model's own id and name, with the terms rewritten in the form it chose. */
  readonly call: ToolCall
}

/**
 * What a rewrite is recorded as: the Tool Round stamps it on the call's
 * `tool_result` event beside the Composed Address stamp, so the Run Trace
 * and the Round Audit read the rewrite from the pipeline's own field, never
 * from the wording of the head.
 */
export interface UnseenPhraseRewriteStamp {
  readonly phrases: readonly string[]
  readonly query: string
}

export interface UnseenPhraseRail {
  /** The search a call with Unseen Phrases runs as; null for every other call, a search with none included. */
  rewrite(call: ToolCall): Promise<UnseenPhraseRewrite | null>
}

function listed(phrases: readonly string[]): string {
  const quoted = phrases.map((phrase) => `"${phrase}"`)
  return quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
}

/**
 * The line a rewritten call's result opens with, in ADR 0055's form: what
 * was unquoted, why, and what ran. One head names every span.
 */
export function unseenPhraseRewriteLine(rewrite: UnseenPhraseRewrite): string {
  const one = rewrite.phrases.length === 1
  return (
    `Rewritten — ${listed(rewrite.phrases)} ${one ? 'appears' : 'appear'} in nothing this run was shown, so ${one ? 'it' : 'they'} ran unquoted: ${rewrite.query}. ` +
    'Quote only a phrase you were shown — on a page, in the user’s words or in a report.'
  )
}

/** The outcome the model reads for a rewritten call: the head, then the search's own outcome, failed or not. */
export function withUnseenPhraseRewrite(outcome: ToolResultOutcome, rewrite: UnseenPhraseRewrite): ToolResultOutcome {
  const line = unseenPhraseRewriteLine(rewrite)
  if (!outcome.ok) return { ok: false, error: `${line}\n${outcome.error}` }
  return typeof outcome.result === 'string' ? { ok: true, result: `${line}\n${outcome.result}` } : outcome
}

// ---------------------------------------------------------------------------
// Folding: what a page may print differently is folded on both sides — case,
// whitespace runs, curly and straight quotes and apostrophes, dash variants —
// and a span loses its edge punctuation. No stemming, no fuzzy match.
// ---------------------------------------------------------------------------

const DOUBLE_QUOTES = '"“”„‟″'
const SINGLE_QUOTE_RE = /[‘’‚‛′]/g
const DOUBLE_QUOTE_RE = /[“”„‟″]/g
const DASH_RE = /[‐‑‒–—―−]/g
const WHITESPACE_RE = /\s+/g
const EDGE_PUNCTUATION_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu
/** A double-quoted span, straight or curly, either way round. Single quotes never make one. */
const SPAN_RE = new RegExp(`[${DOUBLE_QUOTES}]([^${DOUBLE_QUOTES}]*)[${DOUBLE_QUOTES}]`, 'g')

function fold(text: string): string {
  return text.replace(DOUBLE_QUOTE_RE, '"').replace(SINGLE_QUOTE_RE, "'").replace(DASH_RE, '-').replace(WHITESPACE_RE, ' ').trim().toLowerCase()
}

/** A span's key: folded, with the punctuation at its edges gone; empty when nothing but punctuation was quoted. */
function spanKey(span: string): string {
  return fold(span).replace(EDGE_PUNCTUATION_RE, '')
}

/** The keys of every judged span in a text: the double-quoted spans that hold a letter or digit. */
function spanKeysOf(text: string): string[] {
  return [...text.matchAll(SPAN_RE)].map((match) => spanKey(match[1]!)).filter((key) => key !== '')
}

/** A line's key: folded, without double quotes, so an engine printing the query unquoted still echoes it. */
function lineKey(line: string): string {
  return fold(line).replace(/"/g, '')
}

/** A line percent-decoded the lenient way, `+` as space, so a `url=` line carrying the query encoded still reads as the query; a line naming no address is read as printed. */
function decodedLoosely(line: string): string {
  if (!/url=|https?:\/\//.test(line)) return line
  try {
    return decodeURIComponent(line.replace(/\+/g, ' '))
  } catch (error) {
    // A stray `%` in a page's text is no escape: the line reads as printed.
    reportFault('pipeline.unseenPhraseRail.decodedLoosely', error)
    return line
  }
}

/**
 * Whether a line of a results observation is a Search Echo: it carries the
 * search's whole query, or it is the page title, the header or a `value=`
 * line and carries any quoted span of it. A result's own line carries a span
 * without being one.
 */
function isEcho(line: string, whole: string, spans: readonly string[]): boolean {
  const keys = [lineKey(line), lineKey(decodedLoosely(line))]
  if (keys.some((key) => key.includes(whole))) return true
  const structural = line.includes(' title="') || line.startsWith('# ') || (line.startsWith('[') && line.includes(' value="'))
  return structural && spans.some((span) => keys.some((key) => key.includes(span)))
}

/** The sight one shown text gives: its folded text, less its Search Echoes when it came from a Search URL. */
function sightOf(shown: ShownText): string {
  const search = shown.sourceUrl !== undefined ? parseSearchUrl(shown.sourceUrl) : null
  if (search === null) return fold(shown.text)
  const whole = lineKey(search.query)
  const spans = spanKeysOf(search.query)
  const lines = shown.text.split('\n').filter((line) => !isEcho(line, whole, spans))
  return fold(lines.join('\n'))
}

// ---------------------------------------------------------------------------
// The search forms (ADR 0059), each rebuilt in the form the model chose.
// ---------------------------------------------------------------------------

/** A search's terms and how to run other terms in the same form. */
interface Search {
  readonly terms: string
  rebuild(terms: string): ToolCall
}

/** The parameter a Search URL carries its terms in, as parseSearchUrl reads it: a `q` first, else the first parameter named for terms. */
function termsParamOf(url: URL): string | null {
  let named: string | null = null
  for (const [name, value] of url.searchParams) {
    if (value.trim() === '') continue
    if (name.toLowerCase() === 'q') return name
    named ??= name
  }
  return named
}

function navigateSearchOf(call: ToolCall): Search | null {
  const raw = call.args.url
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = parseSearchUrl(raw)
  if (parsed === null) return null
  const withUrl = (url: string): ToolCall => ({ ...call, args: { ...call.args, url } })
  const address = normalizeUrlInput(raw)
  // Bare terms: the browser searches them, and the rewrite stays bare.
  if (address === null || address === searchUrl(raw.trim())) return { terms: raw.trim(), rebuild: withUrl }
  let url: URL
  try {
    url = new URL(address)
  } catch (error) {
    reportFault('pipeline.unseenPhraseRail.navigateSearchOf', error)
    return null
  }
  if (parsed.form === 'path') {
    return {
      terms: parsed.query,
      rebuild: (terms) => {
        const rebuilt = new URL(url)
        rebuilt.pathname = [...url.pathname.split('/').slice(0, -1), encodeURIComponent(terms)].join('/')
        return withUrl(rebuilt.toString())
      },
    }
  }
  const param = termsParamOf(url)
  if (param === null) return null
  return {
    terms: parsed.query,
    rebuild: (terms) => {
      const rebuilt = new URL(url)
      rebuilt.searchParams.set(param, terms)
      return withUrl(rebuilt.toString())
    },
  }
}

export function createUnseenPhraseRail(deps: UnseenPhraseRailDeps): UnseenPhraseRail {
  // The normalised sight of each shown text, keyed by the text itself: the
  // ledger only grows, so a record folded once stays folded.
  const sight = new Map<string, { sourceUrl: string | undefined; key: string }>()

  function sightKeys(): string[] {
    let shown: readonly ShownText[] = []
    try {
      shown = deps.shownTexts()
    } catch (error) {
      // A sight seam that throws shows nothing; the search still runs.
      reportFault('pipeline.unseenPhraseRail.shownTexts', error)
    }
    return shown.map((record) => {
      const cached = sight.get(record.text)
      if (cached !== undefined && cached.sourceUrl === record.sourceUrl) return cached.key
      const key = sightOf(record)
      sight.set(record.text, { sourceUrl: record.sourceUrl, key })
      return key
    })
  }

  async function typedSearchOf(call: ToolCall): Promise<Search | null> {
    const ref = refNumberOf(call)
    const text = call.args.text
    if (ref === null || !deps.describeRef || typeof text !== 'string') return null
    let facts: SnapshotRef | undefined
    try {
      facts = await deps.describeRef(ref)
    } catch (error) {
      reportFault('pipeline.unseenPhraseRail.describeRef', error)
      return null
    }
    if (facts === undefined || !isSearchInputRef(facts)) return null
    // The trailing newline is the submit gesture: it stays.
    const terms = text.replace(/[\r\n]+$/, '')
    const submit = text.slice(terms.length)
    return { terms, rebuild: (rewritten) => ({ ...call, args: { ...call.args, text: `${rewritten}${submit}` } }) }
  }

  async function searchOf(call: ToolCall): Promise<Search | null> {
    if (call.name === 'navigate') return navigateSearchOf(call)
    if (call.name === 'type') return typedSearchOf(call)
    return null
  }

  return {
    async rewrite(call) {
      const search = await searchOf(call)
      if (search === null || !SPAN_RE.test(search.terms)) return null
      SPAN_RE.lastIndex = 0
      const seen = sightKeys()
      const phrases: string[] = []
      const query = search.terms.replace(SPAN_RE, (quoted: string, inner: string) => {
        const key = spanKey(inner)
        // An empty or punctuation-only span is left alone; so is one seen anywhere.
        if (key === '' || seen.some((text) => text.includes(key))) return quoted
        phrases.push(inner)
        return inner
      })
      if (phrases.length === 0) return null
      return { phrases, query, call: search.rebuild(query) }
    },
  }
}
