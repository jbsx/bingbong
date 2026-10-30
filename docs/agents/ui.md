# UI principles

The person is predicting when the wait ends and what it ends with.
Every rule below either lets that prediction land faster or stops it
landing wrong. Each is "it has to X because Y"; Y is a limit of
perception or memory, not taste, so a new case is settled by the
reason, not by the example.

## The distance

The app runs on a 21-inch 1080p panel, read from about 2 m. The whole
screen covers about 13° of vision, so the person sees all of it in one
or two fixations and never hunts; what they lose is detail.
Comfortable reading needs letters about 20 arcminutes tall.

| what | at 2 m on this panel |
|---|---|
| comfortable cap height | ~12 mm, ~48 px |
| font size giving that cap height | ~65 px |
| web body text at the pane's 140 % zoom | ~22 px, ~5 mm |

Page text is a third of legible from the chair. From 2 m "show me" is
"read me" for anything on a page, and the dashboard is a handful of
items at 65 px and up, never a panel of text.

## The ten

1. **Every input gets an instant receipt that shows the words heard,
   before anything is done**, because a person cannot tell a slow right
   action from a wrong one or a dropped one until they see what landed,
   and doubt makes them repeat it, which fires twice. Within 100 ms, on
   screen, heard words separate from action taken.

2. **A wait is narrated by the work itself until it ends in a spoken
   outcome**, because the sense that the app is alive comes from
   change, and a static message is read as the last thing it drew
   before dying. Stage and object named; seconds counting on the
   renderer's own clock, so a count that stops is the one true "frozen"
   signal and slow never looks like stuck; partial results as they
   arrive; "longer than usual" at a threshold measured from the perf
   logs, since a guessed one cries wolf or stays quiet and either
   teaches the person to ignore it; every stage bounded and the bound
   said aloud. A cold start is a wait and gets the same treatment,
   because the first interaction sets the baseline for all the rest.

3. **Nothing happens that was not asked, and anything that did happen
   is undone as fast as it was done**, because the app fires without
   confirming (ADR 0076), and that is only safe when a wrong act costs
   one more line. Stop acts within the reaction, since the person
   reaching for it has already decided the app is stuck; undo and back
   work everywhere; a destructive phrase never shares its sounds with a
   daily one, since alike phrases are confused at a rate practice never
   drives to zero.

4. **Responsiveness outranks decoration on every frame**, because the
   app is judged by its worst moment, and on a weak CPU the decoration
   is what causes it. Motion exists only to show where something went
   or that something is alive; transitions stay under 300 ms, past
   which the animation is itself a wait; whatever costs the reaction
   goes first.

5. **The screen is a glance surface, and its first job is to say
   whether speaking now will be heard**, because the person is looking
   at the pane or at nothing, and speaking into the wrong state reads
   as deafness. Status items at 65 px and up; contrast 7:1; a dark
   ground with full-brightness foreground, dimmed at night, because the
   pupil adapts to the brightest thing in view; the last spoken result
   kept on screen, because speech cannot be scrolled back by ear.

6. **Everything the person can act on carries a visible name they can
   say, and no two live things answer the same words**, because voice
   cannot point. A control without a spoken handle is unreachable
   however well it affords a click; a dead thing looks dead, since a
   failed try on it feels like a hang; only the words that apply right
   now are offered, since an offered word that cannot fire will be
   said; when something is out of voice's reach the app says so and
   says where it is, since the person has no other way to learn the
   boundary.

7. **One thing on the screen is clearly first, related things sit
   within one fixation, and groups are separated by more space than is
   inside them**, because the eye lands somewhere in the first fixation
   regardless, reads grouping from proximity before reading text, and
   holds about four items for a few seconds. Exact alignment, since a
   pixel off is seen before it is read; two typefaces and four sizes,
   since every size is a rank to learn; compared numbers on one
   baseline with one unit and tabular figures, since numbers are
   compared by shape before they are read.

8. **Colour reinforces meaning and never carries it alone, with one
   accent reserved for what is live**, because a tenth of men cannot
   separate red from green, everyone loses colour at the edge of
   vision, and saturated colour draws the eye involuntarily, so spent
   on decoration it leaves the live thing unmarked. At most five
   meaningful colours; saturation only in small marks, since adjacent
   saturated hues shimmer and large saturated areas fatigue.

9. **One vocabulary across screen, speech and sound**, because each
   distinct wording or chime is a thing to learn, and anything that
   must be learned reads as uncertain until it is. The same state has
   the same word and colour everywhere; one sound means one thing; an
   error says what happened, what it means and what to say next, in
   the person's words, because an error is a broken prediction and
   without the next line the person retries the same thing.

10. **Speech says the result in one sentence, confirms what changed,
    and yields the floor the moment the person speaks**, because speech
    is slow, cannot be skimmed, and is the only channel that reaches
    someone not looking. "Volume 38 percent", nothing procedural; a
    failed line names a line that would have worked, since voice has
    no menu to discover; holding the floor reads as not listening.

## Checking a change

A change that adds a wait, a state, a word on screen or a sentence
spoken is held against every one of the ten. The completion summary
names the principles it met and any it bends, with the reason. A
threshold it introduces is measured from the perf logs or the kiosk
journal; one that cannot be measured yet is a guess, marked so in the
code with what would settle it.
