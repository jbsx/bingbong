# HANDOFF: music orchestration, 2026-10-29 (job 9e8dcda2)

Written by the orchestrator for the next one. The previous handoff (2026-10-28 reliability pass) is in git history at 48b8378b.

## Goal (owner, 2026-10-29)
"Make the app play music with no fuss and as quickly as possible whilst still remaining reliable." Issues #502–#510 were handed over with "answer on my behalf". Opus implementers ran via `claude -p --model opus --permission-mode auto --settings <job>/tmp/impl-settings.json -w impl-N`, with a context-guard hook (300k soft, 350k hard).

## Done (all on gitlab main, all CLOSED)
| Issue | What landed |
|---|---|
| #502 | Now Playing shows title + channel on both roads; 2-correct-by-radiohead 3/3 on Jev |
| #503 | The app keeps its own yt-dlp (`yt-dlp_linux.zip` onedir in userData, checksummed, self-check past 512 KB, rollback), and prefers PATH's while current. Kiosk start-up: onedir ~620 ms vs onefile ~1185 ms |
| #506 | A seek on any page that pauses itself is played on (page-side pause listener, arm c) |
| #507 | The Wait Card (thumbnail, title · channel, "Finding the audio"/"Playing in Ns"), within 35 ms of the Command; same words and clock as the Capsule |
| #508 | A `resume` over a loading play goes to Jev on the overlap card and waits (never "Stopped"); harness checks "Stopped" said while playing |
| #511 | (filed from #502) the pending play is on the joined card; 2-correct-by-coldplay 3/3 at every point on Jev |

## Kiosk
Runs **0.1.4-local.202610291303 = main c6db2c34**, pushed 13:04 on the owner's word. The yt-dlp updater is live there.

## Open / owed
- #506 leftover: the Player's page flag is never cleared after its song ends, so a seek on that page doesn't play on. The fix and its tests are written up in #506 note 4116396410. Not filed.
- #508 arm C (say "just started" instead of "Back on …" once the wait ends): a guess, left unbuilt.
- #507 bends: the card's native view blocks clicks at the pane top for the wait; the card has no spoken handle.
- CONTEXT/ADR wordings drafted in the closing notes of #503, #506, #507, #511 are the owner's to land.
- #490, #469, #452, #439, #415 unchanged.

## How to verify
```sh
git fetch gitlab && git log --oneline -3 gitlab/main
pnpm test && pnpm typecheck && pnpm lint
ssh jbsx@192.168.1.217 'ls -l ~/.local/bin/bingbong.AppImage; ls ~/.config/bingbong/yt-dlp'
```
