# Issue tracker: GitLab

Issues and specs for this repo live as GitLab issues on `jbsx/bingbong`,
while the GitHub account is suspended (since 2026-10-25). #415–#428 were
migrated with their GitHub numbers, so a bare `#n` means the same issue on
both; an issue below #415 lives only on GitHub
(`https://github.com/jbsx/bingbong/issues/<n>`) and cannot be read until the
account is reinstated. New issues number on from #429. On reinstatement the
issues move back and this file returns to GitHub.

There is no `glab`: every operation is a REST call with curl. Set these once
per command:

```sh
GL=https://gitlab.com/api/v4/projects/jbsx%2Fbingbong
H="PRIVATE-TOKEN: $(cat ~/.config/gitlab-token)"
```

`curl -sf` fails on an HTTP error, so check the exit status: a script that
reads an empty issue and carries on has read nothing.

## Conventions

- **Create an issue**: write the body to a file, then
  `curl -sf -H "$H" "$GL/issues" --data-urlencode "title=..." --data-urlencode "description@<file>" --data-urlencode "labels=needs-triage" | jq .iid`.
- **Read an issue**: `curl -sf -H "$H" "$GL/issues/<n>" | jq -r '"TITLE: \(.title)\nSTATE: \(.state)\nLABELS: \(.labels|join(","))\n\n\(.description)"'`,
  and `curl -sf -H "$H" "$GL/issues/<n>/notes?sort=asc&per_page=100" | jq -r '.[]|select(.system|not)|"--- \(.created_at)\n\(.body)"'` for the thread.
- **List issues**: `curl -sf -H "$H" "$GL/issues?state=opened&labels=<label>&per_page=100" | jq -r '.[]|"#\(.iid) [\(.labels|join(","))] \(.title)"'`.
  `state` is `opened`, `closed` or `all`. The number is `iid`; `id` is GitLab's global id and never appears in prose.
- **Comment on an issue**: `curl -sf -H "$H" "$GL/issues/<n>/notes" --data-urlencode "body@<file>"` (or `body=...` inline).
- **Apply / remove labels**: `curl -sf -X PUT -H "$H" "$GL/issues/<n>" --data-urlencode "add_labels=..." --data-urlencode "remove_labels=..."`.
- **Close**: post the closing comment as a note first, then `curl -sf -X PUT -H "$H" "$GL/issues/<n>" -d state_event=close`. To reopen, `state_event=reopen`.
- **Edit the body or title**: `curl -sf -X PUT -H "$H" "$GL/issues/<n>" --data-urlencode "description@<file>"`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external merge requests as feature requests; `/triage` reads this flag.)_

There are no PRs on this repo: work is pushed to `main` on the `gitlab` remote.

## When a skill says "publish to the issue tracker"

Create a GitLab issue.

## When a skill says "fetch the relevant ticket"

Read the issue and its notes as above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: native blocking links are a paid GitLab feature this project does not have. Put `Blocked by: #<n>, #<n>` at the top of the blocked issue's body; a ticket is unblocked when every issue on that line is closed. When work moves a blocker from one issue to another, edit that line and say so in a note on the waiting issue.
- **Frontier query**: list the map's open children (scoped to the map's task list), drop any whose `Blocked by` line names an open issue or that has an assignee; first in map order wins.
- **Claim**: `curl -sf -X PUT -H "$H" "$GL/issues/<n>" -d "assignee_ids=$(curl -sf -H "$H" https://gitlab.com/api/v4/user | jq .id)"`. This is the session's first write.
- **Resolve**: comment with the answer, close, then append a context pointer (gist + link) to the map's Decisions-so-far.
