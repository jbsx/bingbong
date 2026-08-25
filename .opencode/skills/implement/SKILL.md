---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.

If this run implemented a tracker issue and /code-review raised no problems remaining concerning that issue, close it: `gh issue close <number> --comment "<one-line summary of what shipped, with commit reference>"` (see docs/agents/issue-tracker.md). If review raised problems, fix and re-review first — only close once nothing remains. Close only the ticket that was implemented, never the parent spec or wayfinder map issue.
