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
// TWO DEPTHS, ON PURPOSE. The first capture
// (e2e/eval/delegation/pass-1.json) answered both of the shallow
// objectives below serially — 13 and 16 Tool Rounds against a 24-round
// Investigation budget, zero spawn attempts — which falsified this
// issue's original premise: the gate was never the tier, and never
// branch *breadth*. Six pages fit one Run comfortably, so a browse
// worker bought the model nothing, and it correctly declined to spend
// one. Those two stay as the shallow control. The third scenario is the
// treatment: the same three-branch independence at a depth one Run
// cannot absorb serially. What separates them is depth alone — and the
// depth that counts is measured, not assumed. pass-2 answered a
// three-branch, FOUR-leg version of the treatment serially in 15
// rounds, which says this model spends about one Tool Round per page;
// the treatment is now eight legs a chain, where that rate no longer
// fits the budget.
//
// DEPTH IS NECESSARY, NOT SUFFICIENT. At eight legs the two models
// part company on the identical corpus and commit: GLM-5.3-flash spent
// all 25 navigations, hit the 24-round Investigation budget and
// finalized budget_exhausted rather than delegate (pass-3), while
// glm-5.3 spawned two browse workers and met the objective in 13
// rounds (pass-4, the first accepted spawn and the first non-empty
// subagentFinalizations this eval has ever recorded). So a capture is
// unreadable without its orchestrator model, and the deep scenario is
// EXPECTED to fail under a flash-class orchestrator — a probe scenario
// that fails is the finding, never a broken test.
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
    // The DEEP shape (the shallow pair above is the control). Three
    // custody chains, eight legs each, hosts alternating leg by leg,
    // every hop an opaque code reachable only by walking the chain. The
    // depth is set from measurement, not from a guess: pass-2 walked
    // three FOUR-leg chains serially in 15 Tool Rounds, so this model
    // spends about one round per page.
    //
    //   serial   1 index + 3 chains x 8 legs = 25 navigations, so ~26
    //            Tool Rounds — past the 24-round Investigation budget and
    //            into the 32-round hard ceiling, whose top rounds are
    //            reserved for terminal bookkeeping.
    //   branched one chain is 8 navigations (~9 rounds), inside a browse
    //            worker's own 12-round leash (#120), three at once inside
    //            the 5-minute deadline they share with the parent.
    //
    // The window is deliberately narrow: shallower and one Run absorbs
    // it (measured at four legs, pass-2), deeper and no worker could
    // finish its own branch either. Delegation is still never asked for
    // — the command states the chains and their independence, and a
    // spawn is the measurement. This is the scenario that finally
    // produced one: two accepted spawns on glm-5.3 (pass-4) and none on
    // the flash model at the same depth (pass-3), which is why every
    // summary row now carries its capture's model.
    {
      id: 'delegation-consignment-chains',
      kind: 'subagent',
      command: (fixture) =>
        `three consignments are listed at ${fixture.url('/consignment-index')}. each one's custody record is a chain of eight legs, and every leg links only the next one, so the seal number is on the last leg of each chain. for all three consignments, follow the whole chain and tell me the port it departed from and its container seal number`,
      expectedEffort: { tier: 'investigation' },
      // Port and seal for every chain: the port proves leg 1 was read, the
      // seal proves the chain was walked all the way to leg 8. A chain
      // left half-walked, or skipped, cannot pass.
      success: (observation) =>
        answerCovers(observation, [
          'valdez',
          'seal-8123',
          'ostend',
          'seal-4470',
          'trieste',
          'seal-9056',
        ]),
    },
  ]
}
