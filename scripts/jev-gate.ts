#!/usr/bin/env node
// `pnpm jev:gate [dir] [--models a,b] [--with-jev] [--chat a,b]`: the Jev
// corpus asked once of every gate model — the free, deterministic ones on
// the env's host, named by --models or BINGBONG_GATE_MODELS — and judged;
// a case is through the gate only when every model it was asked of passes
// it, and the exit is non-zero otherwise. A weaker model's miss is a card
// problem until shown otherwise (owner, 2026-10-22), and Jev spend stays
// minimal: Jev — the default endpoint, by TYPESAFE_API_KEY, the one model
// that reads the image cases — is asked only with --with-jev. With --chat
// (#465) the same cases are asked of the Planner's chat models instead
// (BINGBONG_PLANNER_* host and key, GLM on Z.ai by default) through the
// appliance's limiter, each with its pass count and latency p50/p95 —
// arm D's number in ADR 0095 — and every call is a `planner-step` span in
// the perf log (`--logs <dir>`, else the app's), which `pnpm perf:report`
// reads. --chat alone asks no decision model unless --models names some.
// Node runs this .ts directly via type stripping (#36), so .ts-extension
// imports here and on its runtime graph.
//
// Usage:
//   pnpm jev:gate [corpus-dir] [--models id,id] [--with-jev] [--chat id,id] [--logs dir]
//
// The host, key and other settings come from BINGBONG_DECISION_* in the
// env, as for jev:replay; the gate overrides only the model per column.

import { createPerfTracer } from '../src/core/perf/perfTracer.ts'
import { PLANNER_STEP_STAGE } from '../src/core/planner/plannerSpan.ts'
import { GATE_MODELS_ENV_KEY, gateCorpus, JEV_CORPUS_DIR } from '../src/main/decision/jevCorpus.ts'
import { resolvePerfLogsDir } from '../src/main/perf/collectPerfRecords.ts'
import { createJsonlPerfSink } from '../src/main/perf/jsonlPerfSink.ts'

const args = process.argv.slice(2)
const VALUED = ['--models', '--chat', '--logs']
const valueOf = (flag: string): string | undefined => {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}
const ids = (named: string | undefined): string[] => (named ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '')
const chat = ids(valueOf('--chat'))
// --chat alone runs the chat models only: BINGBONG_GATE_MODELS is the decision gate's, not this run's.
const models = ids(valueOf('--models') ?? (chat.length > 0 ? undefined : process.env[GATE_MODELS_ENV_KEY]))
const withJev = args.includes('--with-jev')
const dir = args.filter((arg, index) => !VALUED.includes(arg) && !VALUED.includes(args[index - 1] ?? '') && arg !== '--with-jev')[0] ?? JEV_CORPUS_DIR
const logs = chat.length > 0 ? resolvePerfLogsDir([valueOf('--logs') ?? ''], process.env) : undefined
const tracer = logs === undefined ? undefined : createPerfTracer({ sink: createJsonlPerfSink(logs) })
const run = tracer?.mintTurnId()
const gate = await gateCorpus(
  dir,
  { env: process.env, ...(tracer !== undefined && run !== undefined ? { onStep: (span) => tracer.span(run, PLANNER_STEP_STAGE, span.durMs, { ...span.detail, via: 'jev-gate' }) } : {}) },
  { models, withJev, chat },
)
;(gate.code === 2 ? console.error : console.log)(gate.report)
if (logs !== undefined && gate.code !== 2) console.log(`planner-step spans in ${logs} (pnpm perf:report ${logs})`)
process.exitCode = gate.code
