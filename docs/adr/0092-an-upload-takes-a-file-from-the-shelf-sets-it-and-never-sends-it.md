# ADR 0092: An upload takes a file from the Shelf, sets it, and never sends it

## Status

Accepted on 2026-10-26, built for #424 (main 9b49045e, 0b29a2a0, 83f3e746).
The wording is the implementer's draft of 2026-10-24, landed as written;
the orchestrator ruled on the owner's behalf. The owner's rulings of
2026-10-24 on the issue stand behind it: the Shelf is `bingbong_downloads`
plus one folder named in Settings, and an upload sets the file and never
submits.

## Context

A click on a file input opened the GTK Open dialog, which the voice cannot
reach; uploading had no road (#424).

## Decision

- Every file chooser in the pane and in sign-in pop-ups is intercepted. The
  OS dialog never opens, a mouse click included.
- The Shelf is `bingbong_downloads` plus one folder the owner names in
  Settings, read flat. Only these files' names go to the decision host.
  Finding a spoken folder reads the names of home's folders, two levels
  deep; those names stay on the machine.
- When an action opens a chooser, a second ask (the Shelf ask) offers every
  Shelf file with its name, age and size, the field's `accept` shown beside
  it. Jev's pick is set on the field. Measured: one ask with attach options
  lost a case on the gate; filtering by `accept` tied.
- An upload sets the file and never sends it. The Task ends on it, and
  sending the form is a line of its own.
- One file per upload, even on a field that takes several (a guess).

## Consequences

- A desktop mouse user also gets no OS dialog.
- An unanswered chooser is dropped, and the field still reopens.
