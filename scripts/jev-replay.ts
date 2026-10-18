#!/usr/bin/env node
// `pnpm jev:replay [dir]` (#338): every case in the Jev corpus asked of the
// real Jev again — the recorded state and questions, unchanged — and
// judged against the answer each question should get. One PASS or FAIL
// per case, the expected label's probability against the chosen one, and
// a non-zero exit on any failure. It needs TYPESAFE_API_KEY (or the
// BINGBONG_DECISION_* key settings) and is not part of `pnpm test`. Node
// runs this .ts directly via type stripping (#36), so .ts-extension
// imports here and on its runtime graph.
//
// Usage:
//   pnpm jev:replay [corpus-dir]
//
// Without an argument: the corpus in the repo, fixtures/jev-cases.

import { JEV_CORPUS_DIR, replayCorpus } from '../src/main/decision/jevCorpus.ts'

const dir = process.argv[2] ?? JEV_CORPUS_DIR
const replay = await replayCorpus(dir, { env: process.env })
;(replay.code === 2 ? console.error : console.log)(replay.report)
process.exitCode = replay.code
