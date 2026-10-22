#!/usr/bin/env node
// `pnpm jev:gate [dir] [--models a,b] [--with-jev]`: the Jev corpus asked
// once of every gate model — the free, deterministic ones on the env's
// host, named by --models or BINGBONG_GATE_MODELS — and judged; a case is
// through the gate only when every model it was asked of passes it, and
// the exit is non-zero otherwise. A weaker model's miss is a card problem
// until shown otherwise (owner, 2026-10-22), and Jev spend stays minimal:
// Jev — the default endpoint, by TYPESAFE_API_KEY, the one model that
// reads the image cases — is asked only with --with-jev. Node runs this
// .ts directly via type stripping (#36), so .ts-extension imports here
// and on its runtime graph.
//
// Usage:
//   pnpm jev:gate [corpus-dir] [--models id,id] [--with-jev]
//
// The host, key and other settings come from BINGBONG_DECISION_* in the
// env, as for jev:replay; the gate overrides only the model per column.

import { GATE_MODELS_ENV_KEY, gateCorpus, JEV_CORPUS_DIR } from '../src/main/decision/jevCorpus.ts'

const args = process.argv.slice(2)
const at = args.indexOf('--models')
const named = at === -1 ? process.env[GATE_MODELS_ENV_KEY] : args[at + 1]
const models = (named ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '')
const withJev = args.includes('--with-jev')
const dir = args.filter((arg, index) => arg !== '--models' && arg !== '--with-jev' && index !== at + 1)[0] ?? JEV_CORPUS_DIR
const gate = await gateCorpus(dir, { env: process.env }, { models, withJev })
;(gate.code === 2 ? console.error : console.log)(gate.report)
process.exitCode = gate.code
