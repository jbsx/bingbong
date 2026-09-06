# ADR 0032: Region Looks re-render from the page, not from the screenshot

## Status

Accepted

## Context

A questioned Look (#193) stopped the vision loop: the fixed anti-guessing
preamble and the 512-token answer cap turned nine generic descriptions into
two honest "not legible" answers. It could not make dense image text
readable. The manhwa tier-list recapture (`i.redd.it/heka2t2ykljh1.png`,
1888×2113, shrunk to fit the pane) left the S-tier card titles a few pixels
tall in the full-viewport JPEG, and the model then tried an image-proxy crop
it had no budget left for.

Three ways to give the model a closer look were on the table:

1. Crop and upscale the screenshot bitmap in the main process (an image
   library, or Electron's `nativeImage`). Cheap, but it magnifies the pixels
   the screen already lost — a 4 px glyph becomes a 12 px blur.
2. Drive the page's own zoom (`web_zoom_percent`) and re-shoot. Visible to
   the user, persisted to settings, and it moves every ref the DOM snapshot
   holds.
3. Ask the compositor for the region at a higher device scale: CDP's
   `Page.captureScreenshot` takes a `clip` with a `scale`, which
   re-rasterizes that rectangle from the page's own sources. A shrunk-to-fit
   image reaches its native pixels around 3×; text is re-laid out sharp at
   any scale. Nothing the user sees changes.

## Decision

- **A region Look is a compositor re-render.** `look` takes an optional
  `region` beside `question`; the browser port's `screenshot` accepts a
  region and a scale and passes them to the capture as a clip in page
  coordinates: the visual viewport's page offset plus the fraction of its
  size, read from the layout metrics' deprecated `visualViewport` on
  purpose — it and the clip share device-independent pixels, where the
  `cssVisualViewport` the protocol points to differs by the page zoom
  factor. The probe that settled this ran with the pane at zoom 1.3 and
  the clip landed exactly where the math said. No image library, no
  bitmap upscaling.
- **The grammar is percentages of the viewport**, `left,top,width,height`,
  written as one string. The model never knows the viewport's pixel size and
  never needs to: the top fifth is `0,0,100,20` on every screen. A malformed
  region is refused with the grammar in the message; a region without a
  question is refused too — the region bounds an answer, and the page-state
  Describe prompt has nothing to bound.
- **A region covers at most a quarter of the viewport, and zoom is decided
  in code, from the area.** The scale is the square root of the area
  ratio, rounded up, clamped to 3x–4x: a quarter renders at 3x, less than
  a ninth at 4x. A larger region is refused with the cap and the reason in the
  message rather than shown at 2x — on the #195 page the vision model read
  titles that were not there from half-viewport bands at 2x, three runs in
  a row, and read the row exactly at 3x and 4x. The cap keeps the capture
  bounded too: a quarter at 3x is about twice the full screenshot's pixels,
  and a tiny region is not magnified into a blur past the page's own
  sources.
- **It is one Look.** A region Look spends the Vision Budget like any Look,
  keeps the fixed anti-guessing preamble verbatim (the crop's extent and
  scale are stated after it, before the question), keeps the 512-token
  questioned cap and the Describe Vision Deadline, and the screenshot stays
  the only evidence source. The `vision_request` record carries the region
  as the model wrote it and the scale. The no-progress rail keys on the
  region too, normalized the way the tool reads it: the same question over
  a new region is a new inspection, the same region twice — however it is
  written — is refused.
- **The result says what magnification the region got.** Every region
  Look's answer ends with one bracketed line — the region and its zoom,
  and, below the cap, that a smaller region is magnified more. The first
  autonomous recapture asked for bands of half the viewport and more, was
  shown them at 2x, and the vision model read wrong titles off them; a
  scripted probe of the same page read the S row correctly (`The Boxer`,
  `The Greatest E.`, the image's own truncation) from a 50×25 region at
  3x. The region's size is the lever that works, the model cannot know
  the zoom it got unless told, and the result is the moment it decides
  whether to narrow.
- **The glossary does not grow.** Describe and Locate are unchanged; a
  region Look is a Describe. The Look entry gains one sentence.

## Consequences

- The Locate path is untouched: its capture stays the full-width viewport,
  so vision points still map to viewport coordinates (ADR 0008).
- A region's crop is bounded by the visible viewport. Text below the fold
  needs a scroll first, as it always did.
- Every `BrowserController` wrapper must forward the screenshot options,
  and the type system will not catch one that drops them (a zero-argument
  `screenshot` still satisfies the port). The two that wrap the live
  controller — agent activity and the auth popup router — forward them,
  each under a test that says so.
- A refused region still spends the Look: the round charges the Vision
  Budget before the tool runs, as it does for every Look. The refusal names
  the cap and the grammar so the next call is well-formed, and the budget
  (30 per Run) is wide enough that one such call is not a loss worth a
  second charging path.
- The Run's own budgets still bound the whole inspection. A region Look
  is one Look and one round; a model that reconciles a first reading
  against a second spends rounds doing so, and the Direct Action deadline
  ends the Run whether or not the answer has been delivered.
