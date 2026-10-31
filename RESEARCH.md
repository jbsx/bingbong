Do a competitive teardown of WebBrain (https://github.com/webbrain-one/webbrain) and compare it against our app. The goal is a ranked list of concrete improvements for our app, plus a clear picture of where our approach is stronger. This is research only: do not modify our codebase.

## Context

Our app: Bing Bong is a voice-driven browser appliance, used today by one person (the owner) on a normal day at home: an always-on kiosk with a 21-inch panel (i3-7100U), spoken to from about 2 m. It is an Electron 43 app with an embedded Chromium pane, driven over CDP through `webContents.debugger`; each page is collected into numbered refs plus text. After the wake word, a spoken line ("pause", "play let down by radiohead", "open the first video", or an outcome like "find me a cheaper one of these") becomes one or more Commands that fire with no confirmation, and a Misfire is recovered by the next Command rather than prevented (ADR 0076). Around that sit a YouTube Player, an Idle Screen (news, weather, calendar), timers and a scale, Piper for speech, and ElevenLabs or local Parakeet for STT. Current state as of 2026-10-31: in daily use, not yet reliable. The Felt Reaction promises were unmet at the last reading (2026-10-27): Instant about 1.5 s p50 / 15+ s p95 against ≤ 700 ms / ≤ 1.2 s, Quick about 3 s / 15+ s against ≤ 2 s / ≤ 4 s (`docs/agents/reliability.md`). Most daily scenarios are `partly`; the top ones are overlap, play and control (`docs/agents/yield.md`). Overlap, a second line while the first still runs, passes 17/26 on the shipped setup (2026-10-29); goal lines pass 19/60 (2026-10-27). Judge every improvement by what it does to a named scenario on that list.

Our decision engine: Jev (`jev-1.14.0`, TypeSafe's hosted model, `src/core/ports/decisionModel.ts`) is a decision model, not a generating one. Input: a text state, "the card", plus typed questions. The card holds the page address and title, the text in view, media state, each ref's number, kind, label, address and states, links further down, and what the appliance itself holds and offers. Output, for each question: a Choice among the labels offered, with a probability per label, or a Noul, the probability that a statement holds. It writes no free text, calls no tools, and keeps no memory past the "Done so far" line on the card. It decides which one action comes next, plus in the same call the Slot (the words for that action) and, when they apply, the extent or amount, where the words point (page, site or web), audio or video, and whether the line splits into Steps (`src/core/command/jevReading.ts`). It acts only at a probability of 0.7 or more; a failure is an `unavailable` result, never a throw, and the fallback is the Local Match's best guess. Road of a line (`src/main/run/commandRunner.ts`): an exact grammar line fires with no ask; anything else is read first on a small Appliance Card, and on the page card only if Jev picks the page (ADR 0096). A Task is up to five actions, with a Verdict at each hop past the first deciding whether it is done. Code owns the facts, mechanisms and hard policy, always by kind and never by site; Jev owns every choice (AGENTS.md, "Jev decides").

Where an LLM is still used: AGENTS.md's "the one model this branch knows is Jev" is out of date, so trust ADR 0095 over it. (1) The Planner, a chat model behind an OpenAI-compatible endpoint (GLM-5.3 on Z.ai by default, `src/main/planner/`), drives an Errand: one spoken outcome carried across Tasks with a memory. It enters only when a Task ends not done or on `errand <words>`, is on by default, and `BINGBONG_PLANNER=off` turns it off. An action whose effect leaves the appliance (post, send, pay, delete) is said back and waits for yes; code enforces that by control label. (2) The Story Brief writer (GLM-5.3, `src/main/news/briefWriter.ts`) writes the News card's lines, off the Command path. (3) The goal gate's judge, in development only. So the like-for-like comparison with WebBrain's tool-use loop is two-sided: the Task road (Jev) for daily lines and the Errand road (Planner) for goal lines.

Why we believe Jev is more efficient (a belief to test, not a finding): each hop is one bounded ask with no transcript growing across hops and no tool call to parse; an answer can only name something on the card, so it cannot invent a target; the probabilities give a real bar to act or hold at; and exact lines cost no model at all. Measured on the kiosk, 25–27 October 2026, 181 spoken Commands: Jev 1,320 ms p50 / 2,430 ms p95 on cards of 6k+ tokens, about 600 ms / 1,500 ms under 3k, with today's p50 card at 7.8k. Against the belief: Jev alone cannot carry a goal line (0/20 before the Planner, 2/20 on the free arm), and with the Planner goal lines reach 19/60 at p50 19.8 s; page collect (610 ms p50 / 5,790 ms p95) can cost more than the ask. We have no head-to-head measure against an LLM tool loop on the same tasks, so state where WebBrain's evidence supports or undercuts the belief.

Open strategic question: we are an Electron app and are considering becoming a full browser. Gather evidence on this throughout.
Our repo: `/home/jbsx/Projects/bingbong`, branch `main` (remote `gitlab`, `origin` on GitHub is stale; record the SHA you read). Read our AGENTS.md and enough of our architecture to compare like for like. Start with CONTEXT.md for the terms, `docs/agents/yield.md` and `docs/agents/reliability.md`.

WebBrain is an open-source, MIT-licensed AI browser agent shipped as a Chrome/Firefox/Edge extension. It uses an LLM tool-use loop for decisions. Treat its docs/ folder (architecture.md, agent-tools.md, security-model.md, prompt-injection-defense.md, accessibility-tree-and-refs.md, site-adapters.md, etc.), AGENT.md, CHANGELOG.md and TODOs.md as a map. Verify every claim against the code, because docs drift.

## How to work

You are the orchestrator and your context window is like gold. Clone the repo at the current main and record the commit SHA. Read the README, docs/architecture.md and the top-level layout yourself. Then delegate each subsystem below to its own claude cli --model opus agent. Only synthesise and cross-check yourself.

- Analyse src/chrome as the primary build. For src/firefox, have one agent produce only a diff of capabilities and workarounds, not a second full read.
- Give each agent our app's context above, the subsystem scope, and the output template below. Answer their questions on my behalf from our codebase and this brief so nothing is left to guesswork. Use /grill-with-docs where it helps. Escalate to me only for questions about my intent or strategy that the code can't answer.
- Every finding must cite file paths and line ranges. No citation means the finding goes in an "unverified" section.

Subsystems (merge or split as the code dictates):
1. Agent loop: turn flow, step limits, Continue, plan-before-act, scratchpad, loop detection, stop/abort
2. Page perception: accessibility tree, element refs, PDFs, frames, shadow DOM, vision/screenshot fallback
3. Actions and tools: the tool matrix, compact/mid/full tiers, ask/act/dev modes, how actions are verified, retry logic
4. Context management: compaction, tool-result limits, overflow recovery, per-tab conversations, memory
5. Reuse and automation: saved workflows, /teach demonstration learning, /schedule, /watch, skills, site adapters
6. Safety: permission prompts, the security model, prompt-injection defences and their stated known gaps, credential handling, privacy and data flow
7. Providers: provider abstraction, local model support, context window detection, temperature choices
8. Integrations: MCP server, LM Studio plugin, cloud bridge, workflow and config export formats
9. UX: side panel, streaming, slash commands, keyboard shortcuts, localisation
10. Quality: test/ suite, LLM scenario benchmarks, security corpora, CI. How they measure agent reliability.

## Per-subsystem output template

For each feature found:
- What it does and how it works (with citations)
- Decision type: LLM-dependent, deterministic, or hybrid
- Our equivalent: what we have, or "none"
- Comparison: is theirs better, worse, or different? Why?
- JEV fit: could our decision model do this better, cheaper or more reliably? Is the deterministic scaffolding portable to us regardless of decision engine?
- Recommendation: adopt, adapt, ignore, or "we're ahead", with effort (S/M/L) and expected impact

## Specific questions to answer

- Which of their reliability mechanisms exist only to compensate for LLM unreliability? Which solve problems that we will hit too?
- What do they score or benchmark, and could we reuse their scenarios or security corpora to test our app?
- Electron vs. browser: their README says Firefox is far weaker than Chrome because it lacks the Chrome DevTools Protocol. List everything they can't do, or do awkwardly, because they are an extension (CDP limits, trusted events, shadow DOM, cross-tab control, permissions). For each, say whether Electron's webContents.debugger or a full browser would unlock it, and what that implies for our decision.
- What does CHANGELOG.md and git history say about what they had to fix repeatedly? Those are traps we should avoid.

## Budget and handoffs

Monitor each agent's context usage. At 300k tokens, or earlier if it is looping, rereading the same files or drifting from its scope, tell it to reach a clean stopping point within the next few steps. It should write HANDOFF.md covering: goal, completed work, in-progress work, key findings so far, approaches that failed, next steps, and how to verify state. At 350k, require it to stop and write the handoff immediately. Start a fresh agent with the original brief plus HANDOFF.md, and have it verify the findings so far before continuing.

## Final deliverable

Write docs/research/webbrain-teardown.md in our repo (this file is the only exception to the no-modification rule). It should contain:
1. Executive summary: the 10 highest-value improvements, ranked by impact divided by effort
2. Where we are ahead, and why, with evidence
3. Electron vs. full browser evidence and your recommendation, stated as a recommendation for me to decide on
4. The full feature comparison table across all subsystems
5. Per-subsystem detail
6. Unverified claims and open questions
7. Licence note: anything we might port from their code needs MIT attribution

Before finishing, run a separate verification agent that has not seen the analysis. It should spot-check 15 random citations against the code at the recorded SHA and flag any that are wrong. Then draft GitHub issues for the top 10 improvements in our tracker's format, following AGENTS.md. Do not file them. List them in the report for my approval.
