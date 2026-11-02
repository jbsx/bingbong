# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `jbsx/bingbong`. Use the `gh` CLI for all operations. The repo is public, so an issue, a comment and everything pushed can be read by anyone.

The account was suspended from 2026-10-25 to about 2026-11-01, and the tracker lived on GitLab meanwhile. #429–#555 were moved back with their numbers, so a bare `#n` means the same issue on both. Each moved issue and comment opens with a small line giving its GitLab date, because GitHub stamps it with the day of the move. A "note 4116396410" in older prose is a GitLab note id: GitHub has no such number, so find the comment by its date.

GitLab (`jbsx/bingbong`, private) stays as a code backup: `git push origin` reaches GitHub only, and `git push gitlab main` brings the backup up. A shell with no ssh agent cannot reach it; that loses nothing, since GitHub is the home. Its issues are frozen, so nothing new is filed there.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file> --label needs-triage`.
- **Read an issue**: `gh api repos/:owner/:repo/issues/<number> --jq '"TITLE: \(.title)\nSTATE: \(.state)\n\n\(.body)"'`, and `gh api --paginate repos/:owner/:repo/issues/<number>/comments --jq '.[].body'` for the thread.

  A bare `gh issue view` does **not** work against this repo: it prints only `GraphQL: Projects (classic) is being deprecated ... (repository.issue.projectCards)` and **exits 0**, so a script that trusts the exit status reads an empty issue and carries on. `gh issue view <n> --json title,body,comments` is unaffected, as is `gh issue list`.
- **List issues**: `gh issue list --state open --limit 200 --json number,title,labels --jq '.[]|"#\(.number) [\([.labels[].name]|join(","))] \(.title)"'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file <file>`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`. For a long closing comment, `--comment` takes no file: post it first with `gh issue comment <number> --body-file <file>`, then `gh issue close <number>`. To reopen, `gh issue reopen <number>`.
- **Edit the body or title**: `gh issue edit <number> --body-file <file>` / `--title "..."`.
- **Attachments**: the API takes no uploads. Commit the file to the `issue-assets` branch and link its `https://raw.githubusercontent.com/jbsx/bingbong/issue-assets/<path>` address.

Infer the repo from `git remote -v`: `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

There are no PRs on this repo: work is pushed to `main` on `origin`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either. The last PR is #155.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read the issue and its comments as above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only: the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed. Issues filed while on GitLab may still carry a `Blocked by` line from then; the native edge is the one that counts.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
