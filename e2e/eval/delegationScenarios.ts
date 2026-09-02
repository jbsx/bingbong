import type { EvalScenario, ScenarioObservation } from './scenarios'

// The delegation probe corpus (#163) — separate from the release corpus of
// record (e2e/eval/scenarios.ts) on purpose, and never pooled by
// `pnpm eval:accept`.
//
// WHY SEPARATE. #132's decision pools three complete captures per side on
// identical scenario ids in identical order, with the baseline side pinned
// to the pre-#114 tree (git 2343a3c). That tree has no Run Plan, no Effort
// Tier, and therefore no #120 delegation gate: a delegation scenario added
// to the release corpus would invalidate three captured baseline passes in
// order to measure something the baseline literally cannot do. So these
// scenarios live here, capture to e2e/eval/delegation/ (never
// e2e/eval/pools/), and run under their own config — `pnpm test:delegation`
// — so the release capture's shape, cost, and pooled statistics are
// untouched. `eval:accept` refuses any pool carrying an id the release
// corpus does not declare, which is the backstop.
//
// WHAT PROVOKES DELEGATION. Nothing here scripts a spawn — a scripted spawn
// measures the harness, not the model. Each command instead states the
// shape the orchestrator prompt names as delegation's condition: three
// genuinely independent branches, no branch's answer usable as input to
// another's, and every branch spanning two hostnames (the subject's own
// claim on one site, the independent verdict on the other). The
// #130-corpus subagent scenario failed to provoke it because its three
// facts sat at three given URLs — one page each, no branch depth, and the
// orchestrator correctly read them itself at Lookup tier. Depth per branch
// is the variable this corpus changes.
//
// Success stays what it is everywhere else in the eval: the objective, on
// external outcomes only. Whether the model delegated is MEASURED, never
// asserted — a probe that answers correctly without delegating is exactly
// the finding #163 wants recorded, not a failure.

/** An honest answer mentioning every phrase (case-insensitive) — one branch's fact per phrase. */
function answerCovers(observation: ScenarioObservation, phrases: readonly string[]): boolean {
  if (observation.outcome !== 'done' || observation.answerText === null || observation.rawLimitFailure !== null) {
    return false
  }
  const answer = observation.answerText.toLowerCase()
  return phrases.every((phrase) => answer.includes(phrase.toLowerCase()))
}

export function delegationScenarios(): EvalScenario[] {
  return [
    // Three hubs; each hub's dispatch day is on its own page and its defect
    // rate only on the independent audit office's site. Six pages over two
    // hosts behind one index, and the three branches never inform each
    // other — the widest genuinely parallel shape the fixture web offers.
    {
      id: 'delegation-hub-audit-sweep',
      kind: 'subagent',
      command: (fixture) =>
        `the three regional hubs are listed at ${fixture.url('/hub-index')}. for every hub, get its dispatch day from the hub's own page and its defect rate from the independent audit office page that the hub page links to, then tell me all three dispatch days, all three defect rates, and which hub has the lowest defect rate`,
      expectedEffort: { tier: 'investigation' },
      // Every branch's two facts must appear, so a partial sweep cannot pass.
      success: (observation) =>
        answerCovers(observation, [
          'aurora',
          'tuesday',
          '4.1',
          'borealis',
          'friday',
          '0.9',
          'cascade',
          'wednesday',
          '2.7',
        ]),
    },
    // Three competing hypotheses — the prompt's other named condition for a
    // browse worker. Each theory's dossier states the claim and links the
    // lab report that tested it on the other host; exactly one is supported,
    // and ruling out the other two requires reading them too.
    {
      id: 'delegation-recall-theories',
      kind: 'subagent',
      command: (fixture) =>
        `three competing explanations for the Q3 fixture widget recall are filed at ${fixture.url('/recall-brief')}. for each explanation, read its dossier and the independent lab report it links, then tell me which explanation the lab evidence supports, with the measurement it rests on, and say what ruled out each of the other two`,
      expectedEffort: { tier: 'investigation' },
      success: (observation) =>
        answerCovers(observation, ['bearing', '0.4', 'coating', 'packaging']) &&
        // The two rejected theories must be reported as rejected, not just named.
        /not supported|ruled out|rejected|within tolerance|matched spec/i.test(observation.answerText!),
    },
  ]
}
