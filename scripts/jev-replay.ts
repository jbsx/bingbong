#!/usr/bin/env node
// `pnpm jev:replay [dir] [--repeat N]` (#338): every case in the Jev
// corpus asked of the real Jev again — the recorded state and questions,
// unchanged — and judged against the answer each question should get.
// One PASS or FAIL per case, the expected label's probability against
// the chosen one, and a non-zero exit on any failure. With `--repeat N`
// each case is asked N times and the report says per question what was
// chosen how often (PASS, FLIP or FAIL per case): a pick that moves
// between identical runs is noise at the margin, which one replay cannot
// tell from a real move. It needs TYPESAFE_API_KEY (or the
// BINGBONG_DECISION_* key settings) and is not part of `pnpm test`. Node
// runs this .ts directly via type stripping (#36), so .ts-extension
// imports here and on its runtime graph.
//
// Usage:
//   pnpm jev:replay [corpus-dir] [--repeat N]
//
// Without an argument: the corpus in the repo, fixtures/jev-cases, once.

import { JEV_CORPUS_DIR, replayCorpus } from '../src/main/decision/jevCorpus.ts'

const args = process.argv.slice(2)
const at = args.indexOf('--repeat')
const repeat = at === -1 ? 1 : Number(args[at + 1])
if (!Number.isInteger(repeat) || repeat < 1) {
  console.error(`--repeat needs a whole number of runs, got ${args[at + 1] ?? 'nothing'}`)
  process.exit(2)
}
const dir = args.filter((arg, index) => arg !== '--repeat' && index !== at + 1)[0] ?? JEV_CORPUS_DIR
const replay = await replayCorpus(dir, { env: process.env }, { repeat })
;(replay.code === 2 ? console.error : console.log)(replay.report)
process.exitCode = replay.code
