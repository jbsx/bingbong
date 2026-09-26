# ADR 0068: A Decision Model answers a Run's typed questions inside a round, and acts only above a threshold where the model's move is already implied

## Status

Accepted on 2026-09-26 for #274, grilled the same day with every
recommendation taken (the decision is the issue's body). The two seams that
act are [ADR 0069](0069-a-run-makes-an-evidence-checkpoint-from-a-selected-passage-grounded-by-carrying-the-passage-in-the-result-the-model-reads.md)
(Selected Passage) and [ADR 0070](0070-a-result-pick-opens-a-search-landings-best-result-for-a-lookup-or-investigation-with-an-open-asked-item-never-for-a-direct-action.md)
(Result Pick). An experiment: if #274's gate is missed, the pieces are
reverted and this ADR is marked superseded by that capture.

## Context

The 2026-09-26 anatomy of the fix-265-267 capture (30 Runs, median 169 s):
orchestrator rounds are 90.7% of wall time, every round pays a first-token
wait near 4 s that no prompt trim removes, and the rounds are mostly small
decisions the model spends a whole generation on — 3.8 bookkeeping-only
`record_evidence` rounds per Run (54 s), 3.1 rounds hunting Page Read parts,
about 2 rounds per search to read the listing and open a result. The tiny
commands the owner wants fast — a timer, a price — take 2 to 4 rounds and 20
to 30 s. Fewer rounds is the only lever left; #252 through #256 saturated
the prompt-only ones.

Jev (TypeSafe AI, `jev-1.13.0`) is a non-autoregressive model that answers
typed questions over a text state in about 100 ms: a Choice among named
options with a probability per option and a confidence, a Score on ordered
levels, a Noul — the probability a statement holds. It generates no text,
takes no image, and evaluates every question in one request in parallel, so
a second question is nearly free. It cannot write a URL, a query, a Run Plan
or an Answer. It can make, in a tenth of a second, the decision the
orchestrator would otherwise make in a round.

## Decision

- **A Decision Model is a fourth model role**, `decision`, resolved as the
  other three are (`BINGBONG_DECISION_{BASE_URL,MODEL,API_KEY,API_KEY_ENV}`),
  pinned to a versioned model id because thresholds are tuned per version.
  Unconfigured, the app behaves exactly as before; configured, a seam list
  says which seams act. The configured-or-not role is the arm marker in
  every capture's provenance, so an A/B is two pools from one commit.
- **It acts only where the model's next move is already implied** by what
  the Run has been shown and asked: which passage of a landed page states an
  open Asked Item, which result of a listing fits the objective. It never
  widens what a Run may do — no new page, no new action kind, no Consequential
  Action, nothing the Risk Gate would not have judged the same call by.
- **It acts only above a threshold, and otherwise the round proceeds as
  before.** Each seam asks a Choice for the pick and a Noul for whether any
  pick is right; both clear their own thresholds (the numbers of one
  primitive do not carry to another) or nothing happens. A timeout under a
  second, no retries: an error, a slow vendor or a malformed answer resolves
  to "unavailable" and the tool result is byte-identical to today's. The
  seam can cost at most its timeout and can never end a Run.
- **Every question is a Decision Record** in the Run Trace beside the
  `llm_round` records: seam, round, the answers with their probabilities,
  latency, threshold, and whether it acted, fell under threshold, was
  unavailable or ran in shadow. A shadow seam asks and records and never
  acts; agreement with what the model then did is how a seam earns the
  right to act.
- **The state is text the Run already holds** — the observation the ledger
  recorded, the command, the Run Plan — sent with ids on its passages so a
  Choice can point rather than quote. Page text from live sites and the
  user's command therefore leave the machine to a second vendor; accepted
  for the experiment and recorded as the role's model id in provenance.

## Consequences

- A Lookup that lands on the right page can end in one model round: the
  landing carries the passage, the Run has recorded it, and the model
  writes the Answer. Whether that happens on the corpus is #274's gate.
- Thresholds are knobs set from data, not guessed: #275's shadow replay runs
  the saved traces through the port before any seam acts.
- The model's own text is the only ground the Decision Model reads
  (ADR 0033's principle), so adversarial text on a live page can steer a
  pick; the threshold and the "already implied" rule bound the damage to a
  wrong page or a wrong passage, both of which the model sees and can undo.
- Two vendors' latencies now compose in a round. The Decision Record's
  latency is reported per capture so the cost is never hidden inside the
  tool span.

## Relationships

Grounds [ADR 0069](0069-a-run-makes-an-evidence-checkpoint-from-a-selected-passage-grounded-by-carrying-the-passage-in-the-result-the-model-reads.md)
and [ADR 0070](0070-a-result-pick-opens-a-search-landings-best-result-for-a-lookup-or-investigation-with-an-open-asked-item-never-for-a-direct-action.md).
Shares [ADR 0033](0033-a-ref-names-the-element-it-was-shown-as.md)'s
principle that what the Run was shown is the one ground it may act on.
Leaves the Effort Tier rungs (#166, #215, #252) and the Risk Gate untouched.
#268 compares orchestrators on the same clock and is unaffected.

## Implementation note (#275, 2026-09-26)

The fourth role resolves beside the three, not among them:
`resolveDecisionRouting` and `resolveDecisionSeams` in
`src/core/agent/modelRouting.ts`, never `AgentRole`. It serves no loop, holds
no settings row and must not reach `set_setting`. Unlike the three it has
defaults for everything but its key (`https://api.typesafe.ai`,
`jev-1.13.0`, `TYPESAFE_API_KEY`), so a key alone arms it.
`BINGBONG_DECISION_SEAMS` set but empty keeps the key and acts on no seam.
Thresholds are per seam (`DECISION_THRESHOLDS`) and were moved by the
shadow replay's decile table, `e2e/eval/jev/shadow-2026-09-26.json`. The
rule is the lowest decile whose acts agree with the model's pick at least
0.8 over at least ten scored acts, else the highest decile with ten. A step
where the model recorded nothing is its own column, never a disagreement.
The replay measured Jev at a median of about 220 ms, not the 100 ms this
ADR's context assumed.
