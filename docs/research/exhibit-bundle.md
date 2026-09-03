# Bundled Exhibit libraries and offline rendering (#171)

Research for the Exhibit map (#169): what Bing Bong ships so an Exhibit
renders offline, deterministically, on the kiosk, with no CDN. Measured
2026-09-03 against mermaid 11.17.2, Electron 43.4.0 (Chrome 150), the app's
`styles.css` at `40f7de0`, and the electron-vite 5 / Electron docs. The probe
harness and the stub are reproducible; the stub is checked in beside this
note (`docs/research/exhibit-stub.html`).

## Recommendation

- **Mermaid: bundle `mermaid/dist/mermaid.min.js` (the UMD/IIFE single
  file), 3,572,661 B.** Not the ESM build: its 30 KB entry lazy-loads 103
  chunks totalling 3,491,835 B, so it saves nothing on disk and multiplies
  the files the app scheme must serve. Mermaid renders under a strict CSP
  with `securityLevel: 'strict'` (the default) as long as `style-src`
  carries `'unsafe-inline'`; it needs no `'unsafe-eval'` and makes no
  network requests. Six diagrams render in 170–190 ms, identical with the
  GPU process disabled.
- **Design sheet: a fixed `exhibit.css` (~6 KB minified) whose `:root` tokens are
  copied name-for-name from `src/renderer/src/styles.css`**, dark palette
  under `@media (prefers-color-scheme: dark)`. The isolated view inherits
  `prefers-color-scheme` from `nativeTheme.themeSource` (ADR 0020's
  mechanism), so `system|light|dark` needs no JS and no attribute. Pair it
  with a ~2.5 KB `exhibit.js` runtime (theme-following Mermaid init, tabs,
  sortable tables) so the model writes HTML+CSS and no script. Runtime
  Tailwind is out: the play CDN is a 400 KB JIT compiler, and the report
  format uses maybe forty utilities.
- **Charts: hand-written SVG/CSS for v1.** No chart library. Mermaid already
  ships `pie`, `xychart-beta`, `quadrantChart`, `timeline`, `sankey`,
  `radar`, `treemap` for the cases where a chart is graph-shaped; a
  `.bars` primitive in the sheet covers the comparison bar, which is what
  Investigation answers actually need.
- **Serving: a privileged `exhibit:` scheme on a dedicated in-memory
  session**, `protocol.handle` returning the HTML from memory
  (`exhibit://<answer-id>/`) and the bundle from disk (`exhibit://lib/…`),
  CSP as a response header. Not inlined into the HTML: inlining puts
  3.5 MB into every Exhibit document, loses V8 code caching, and forces the
  CSP into a `<meta>` tag the model's output must carry correctly.
- **Size: ~3.93 MB shipped** (Mermaid 3.57 MB + Inter regular 352 KB +
  sheet + runtime); **cap the render call's HTML at 64 KB, reject above
  it, and prompt for ≤ 24 KB.** The stub below — a full Pocock-shaped page
  with two diagrams, a table, a chart, tabs — is 19.7 KB with the sheet
  and runtime inlined, 7.5 KB without them.

## Mermaid

### Which build

`npm view mermaid dist` (11.17.2) ships four bundles under `dist/`:

| file | bytes | notes |
| --- | ---: | --- |
| `mermaid.min.js` | 3,572,661 | UMD/IIFE, one file, defines `window.mermaid`; gzip -9 = 975,709 |
| `mermaid.esm.min.mjs` | 30,255 | entry only; `import()`s 103 chunks from `dist/chunks/mermaid.esm.min/` |
| `dist/chunks/mermaid.esm.min/*.mjs` | 3,491,835 | largest chunk 705,086; `katex-*.mjs` 272,628 |
| `mermaid.js` | 8,254,234 | unminified |
| `*.map` | 13,346,621 | source maps for the UMD alone; do not ship |

The ESM build's only advantage is lazy loading of diagram parsers the page
never uses. For an app scheme that means 104 URLs to serve and cache
instead of one, for the same disk footprint; the flowchart + sequence
chunks the Pocock format leans on are among the largest anyway. UMD it is.
`mermaid.core.mjs` (65 KB) externalises d3/dagre/etc. and is for bundlers —
not relevant unless the Exhibit runtime is itself built by Vite, which it
should not be (see Serving).

Verified in the bundle (grep of `mermaid.min.js`):

- `new Function(` — 0 hits; `eval(` — 0 hits. No `'unsafe-eval'` needed.
- Remote URLs: only XML namespaces and documentation links inside error
  strings (`chevrotain.io`, `github.com/mermaid-js/mermaid/issues`). No
  `@font-face`, no `fonts.googleapis`, no fetch. Fully offline.
- Default config: `securityLevel: "strict"`, `startOnLoad: true`,
  `fontFamily: '"trebuchet ms", verdana, arial, sans-serif;'`,
  `maxTextSize: 50000`, `maxEdges: 500`, `htmlLabels` root flag.
- Inline styles: 198 call sites of `.attr("style", …)` plus one `<style>`
  element inserted into every rendered SVG
  (`document.createElement("style"); k.innerHTML = S; T.insertBefore(k, w)`).
- `securityLevel: 'sandbox'` renders each diagram inside
  `<iframe sandbox="" style="width:100%;height:100%">` (`sandboxedIframe`).

### Does it render under a strict CSP in a sandboxed view?

Probe: Electron 43.4.0, a `BrowserWindow` with
`{ sandbox: true, contextIsolation: true, nodeIntegration: false }` and no
preload; `exhibit` registered with
`registerSchemesAsPrivileged([{ scheme: 'exhibit', privileges: { standard: true, secure: true, codeCache: true } }])`;
`protocol.handle('exhibit', …)` serving the page and `mermaid.min.js` from
disk via `net.fetch(pathToFileURL(...))`; Xvfb 1280×800. Six diagrams
(5 flowcharts with `classDef`, 1 sequence). Each variant run once, the
recommended CSP three times.

| CSP variant | rendered | `mermaid.run` ms | page load ms | violations |
| --- | --- | ---: | ---: | --- |
| `default-src 'none'; script-src exhibit: 'unsafe-inline'; style-src exhibit: 'unsafe-inline'; img-src data: exhibit:; font-src exhibit:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'` | 6/6 SVGs | 174 | 261 | none |
| same, `--disable-gpu` | 6/6 | 172, 184 | 265, 346 | none |
| `style-src exhibit:` (no inline styles) | 6/6 SVGs, unstyled (width 969 vs 887) | 191 | 350 | "Applying inline style violates … 'style-src exhibit:'" ×6+ |
| `script-src exhibit:` only, init from a bundled file | 6/6 | 175 | 264 | none |
| `securityLevel: 'sandbox'`, `frame-src about:` | 0 SVGs, 6 iframes | — | 300 | "Framing '' violates … frame-src" ×6 |

Conclusions:

- **`style-src` must carry `'unsafe-inline'`.** Without it Mermaid still
  lays out but every node style and the per-SVG `<style>` element are
  dropped. This is acceptable: styles are not a script vector, the model's
  own `<style>` block and `style=""` attributes are the point of the format,
  and the view has no origin worth exfiltrating from.
- **`script-src` does not need `'unsafe-inline'`** if the init comes from a
  bundled `exhibit.js`. That is the recommended shape: the model never
  writes `<script>`, so evidence text that smuggles `<script>` through the
  render call cannot execute. The map's "self-contained interactivity" then
  means declarative hooks (`.tabs`, `table[data-sortable]`, `<details>`)
  that the runtime wires — see the stub.
- **Use `securityLevel: 'strict'` (the default).** It DOMPurify-sanitises
  labels and disables Mermaid's own `click` callbacks. `'sandbox'` adds a
  srcdoc iframe per diagram that the CSP has to open `frame-src` for, breaks
  `useMaxWidth` sizing, and buys nothing: the whole view is already a
  sandboxed, preload-less WebContents. `'loose'` is out — it enables
  `click` callbacks and `javascript:` hrefs.
- **`htmlLabels: false`.** Mermaid's default HTML labels render through
  `<foreignObject>`; SVG text labels are theme-consistent, copyable, and
  avoid the foreignObject sizing bugs under Xvfb/software compositing.

Output: ~18.6 KB of SVG per flowchart (111,711 chars for six), so a page
with four diagrams grows by ~75 KB after render — the cap below is on the
authored HTML, not the rendered DOM.

### Cost on software rendering (ADR 0023 crash-loop fallback)

Xvfb reports `gpu_compositing: disabled_software` with or without
`--disable-gpu`, so all probe numbers are already the software path:
**~30 ms per diagram**, ~260 ms to load and parse the 3.5 MB script cold.
Mermaid's cost is CPU (dagre layout in JS, DOM construction), not GPU;
disabling the GPU process changed nothing measurable (172–184 vs 174 ms).
The `codeCache` privilege on the scheme lets Chromium cache the compiled
script across Exhibits, which inlining cannot get.

The real cost on the Hardware Floor is the extra renderer process the
isolated view is: budget ~60–80 MB RSS while an Exhibit is open. Create the
view when the first Exhibit of a Session lands, reuse it for later Exhibits
(one live Exhibit at a time — the map says one Answer, at most one Exhibit,
and the Feed re-opens the last one), destroy it at Lapse/Reset with the rest
of the Session.

### Theming Mermaid

Mermaid themes are JS config, not CSS: the runtime reads the sheet's tokens
with `getComputedStyle(document.documentElement).getPropertyValue('--panel')`
and passes `theme: 'base'` with `themeVariables` (`darkMode`, `background`,
`primaryColor`, `primaryTextColor`, `primaryBorderColor`, `lineColor`,
`textColor`, `fontFamily`) — all present in the bundle. On
`matchMedia('(prefers-color-scheme: dark)').change` the runtime re-renders
from the source it stashed in `data-src` (~30 ms per diagram). The stub
does exactly this; verified light (`body` = `rgb(245,245,247)`) and dark via
`nativeTheme.themeSource = 'dark'` (`body` = `rgb(30,30,32)`, diagram nodes
re-rendered with the dark tokens).

## The design sheet

### What `HTML-REPORT.md` needs

The Pocock reference (`improve-codebase-architecture/HTML-REPORT.md`) is
built from a short list of Tailwind classes; the sheet has to cover these and
nothing more:

| report element | Tailwind used | sheet provides |
| --- | --- | --- |
| page | `bg-stone-50 text-slate-900 font-sans`, `max-w-5xl mx-auto px-6 py-12 space-y-12` | `body`, `main`, `.stack`, `.stack-lg` |
| header + legend | text utilities | `.label`, `.row`, `.muted`, `.small` |
| candidate card | `<article>` + `rounded-lg border border-slate-200 bg-white p-4` | `.card`, `.card--deep` |
| badge row | emerald / amber / slate pills | `.badge`, `.badge--strong`, `.badge--worth`, `.badge--speculative` |
| files list | `font-mono text-sm` | `.files`, `.mono` |
| before / after | two columns side by side, diagrams ~320 px tall | `.cols-2`, `.diagram` |
| Mermaid card | bordered white card around `pre.mermaid` | `.diagram`, `pre.mermaid` reset |
| hand-built boxes and arrows | bordered divs, inline SVG lines | `.box`, `.box--deep`, `.box--faded`, `.seam`, `.leak` |
| cross-section bands | `h-12 border-l-4` | `.band`, `.band--thin`, `.band--deep` |
| module labels in diagrams | `text-xs uppercase tracking-wider` | `.label` |
| problem / solution / wins | plain prose, bullets | `p`, `.wins` |
| ADR callout | amber-tinted box | `.callout`, `.callout--info`, `.callout--danger` |
| colour discipline | one accent + red leakage + amber warning | `--accent`, `--status-red`, `--status-yellow` |

Bing Bong adds what the report format does not have and the map asks for:
a comparison table (`table`, `th.num`, `.pick`, `[data-sortable]`), a bar
chart primitive (`.bars`, `.bar-row`, `.bar`, `.bar--good`, `.bar--warn`),
tabs (`.tabs [role=tab]`), collapsibles (`<details>`), and links styled as
the Feed's (accent, underlined — one click navigates the pane).

The stub's sheet is 8,438 B unminified with comments, ~6.0 KB minified;
the runtime is 3,758 B, ~2.6 KB with comments and indentation stripped. Tailwind's play CDN, for comparison, is a ~400 KB script that
compiles classes at runtime — a JIT the kiosk pays per Exhibit for forty
utilities, with a dark mode (`class="dark"`) that does not follow
`prefers-color-scheme` without configuration.

### Can `styles.css` be the source of truth?

Yes for the tokens, no for the file. `src/renderer/src/styles.css` (1,572
lines) is the dashboard skin: `:root` tokens on lines 28–57 (`--bg`,
`--panel`, `--panel-overlay`, `--panel-peek`, `--edge`, `--bubble`, `--text`,
`--muted`, `--accent`, `--status-{blue,purple,yellow,green,red}`,
`--code-bg`, `--code-text`, `--font-scale`), the dark palette on lines
64–83 under `@media (prefers-color-scheme: dark)`, then 1,400 lines of
Toolbar, Feed, Settings and Status Capsule rules the Exhibit must not
inherit. `overlay.css` links `styles.css` for its tokens (ADR 0020: "dark
tokens live only there — one source").

Options:

1. **Extract the token block into `src/renderer/src/tokens.css`**, have
   `styles.css` import it (Vite inlines `@import` at build), and have the
   Exhibit sheet built by concatenating `tokens.css` + `exhibit.css`. One
   source, three consumers. ADR 0020's "one source" stays literally true.
2. Copy the tokens into `exhibit.css` and pin them with a unit test that
   parses both files' `:root` blocks and asserts equality.

Option 1 is the honest one and touches `styles.css` only by moving 55 lines.
It also keeps `--font-scale` in play: the Exhibit view is a separate
WebContents, so the Settings font scale would need to be injected — the
render call can set `<html style="--font-scale: 1.1">` from the Setting at
serve time, which is the one place the app touches the Exhibit's HTML.

`--panel-overlay` and `--panel-peek` (alpha skins for the native overlay
view) have no meaning inside the Exhibit; the sheet ignores them. The
Exhibit adds four tints derived with `color-mix()` from the status colours
so badges and callouts stay in the Apple palette in both appearances instead
of importing Tailwind's emerald/amber/slate.

### Fonts

`styles.css` bundles `InterVariable.woff2` (352,240 B) and
`InterVariable-Italic.woff2` (387,976 B) via `@font-face`; Vite emits them
as `out/renderer/assets/InterVariable-<hash>.woff2`. The Exhibit cannot
reference the hashed name, so either ship the regular face a second time
through the scheme (`exhibit://lib/InterVariable.woff2`, +352 KB, `font-src
exhibit:`) or fall back to `system-ui`. Recommend shipping the regular face
only — ADR 0012 makes Inter the SF Pro stand-in and the Exhibit sits inside
the same window as the panel; synthesised italics are fine for a document.
`ui-monospace, monospace` for code as today.

## Charts

Hand-written SVG and CSS for v1; no library. Grounds:

- The reference format is explicit that editorial visuals are "hand-built
  divs and inline SVG" and warns against leaning on one tool ("it'll start
  to look generic"). Investigation answers are shortlists, comparisons,
  prices against a budget, rankings — a `.bars` row per candidate says it.
- Mermaid is already 3.5 MB on disk and covers the graph-shaped charts:
  `pie`, `xychart-beta` (bar and line), `quadrantChart`, `timeline`,
  `sankey-beta`, `radar-beta`, `treemap-beta` are all in the UMD.
- Measured alternatives, for the record: chart.js 4.5.1 `dist/chart.umd.js`
  208,518 B (70,397 gz); uPlot 1.6.32 `dist/uPlot.iife.min.js` 51,081 B
  (22,009 gz) + 1,857 B CSS. Both render to `<canvas>`: a bitmap that does
  not pick up the CSS tokens, needs JS colour config per theme (and a
  re-draw on theme change), animates on a CPU the Hardware Floor does not
  have to spare, and is not copyable or inspectable. uPlot is time-series
  shaped; chart.js is general but its output would sit beside SVG diagrams
  and look parachuted in.
- The cost of being wrong is small: adding uPlot later is +53 KB and one
  `<script src="exhibit://lib/uPlot.iife.min.js">` in the page template.
  Revisit when an eval scenario shows the model producing broken hand-made
  axes on real data.

## Serving

### App scheme, not inlining

Register `exhibit` as a privileged scheme before `app.ready`
(`protocol.registerSchemesAsPrivileged` "can only be used before the ready
event … and can be called only once"; the app already calls
`app.commandLine.appendSwitch` at module top in `src/main/index.ts` for the
GPU guard — same slot):

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: 'exhibit', privileges: { standard: true, secure: true, codeCache: true } },
])
```

`standard` gives RFC 3986 URLs, so `exhibit://<answer-id>/` is an origin per
Exhibit and relative URLs resolve; `secure` unlocks secure-context APIs;
`codeCache` lets V8 cache the compiled 3.5 MB script. No `supportFetchAPI`,
no `corsEnabled`, no `bypassCSP` — the page must not fetch anything.

Serve on a **dedicated non-persistent session**
(`session.fromPartition('exhibit')`, no `persist:` prefix) so the Exhibit
never shares cookies or the adblocker's `webRequest` hooks with the
`persist:browse` partition (`attachAdblock` covers "the persistent browse
partition — main pane and subagent tabs"). `protocol.handle` is
per-session: register on `ses.protocol`, not the default session.

```ts
ses.protocol.handle('exhibit', (req) => {
  const { host, pathname } = new URL(req.url)
  if (host === 'lib') return net.fetch(pathToFileURL(join(libDir, basename(pathname))).toString())
  const exhibit = exhibits.get(host) // in-memory, session-scoped
  if (!exhibit) return new Response('', { status: 404 })
  return new Response(exhibit.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': EXHIBIT_CSP, // header, not <meta>
    },
  })
})
```

The Electron security guide prefers the header ("CSP's preferred delivery
mechanism is an HTTP header … not possible … using the `file://`
protocol"); a scheme handler controls headers, so the model's HTML carries
no `<meta http-equiv>` the app would have to validate. The view is a
`WebContentsView` with `{ session: ses, sandbox: true, contextIsolation:
true, nodeIntegration: false }` and no `preload` — the same shape as the
browser pane minus the preload it never had. `will-navigate` →
`preventDefault()` + the existing navigate seam into the pane;
`setWindowOpenHandler` → `{ action: 'deny' }`.

Why not `loadURL('data:text/html,…')` / `srcdoc` with everything inlined:
3.5 MB per Exhibit document held in the main process and copied into the
renderer, no code cache, `baseURLForDataURL` would still be needed for
fonts, the CSP has to ride in a `<meta>` tag inside model output, and
`data:` documents have an opaque origin that breaks nothing here but
complicates `localStorage`-style per-Exhibit state if it ever comes.

### electron-vite implications

`electron.vite.config.ts` has three targets; the Exhibit bundle is static
and belongs to **main**, which serves it. Per the electron-vite asset docs:

- `?asset` imports in main "resolve with hashed filename and get copied to
  `out/main/chunks/`" — this is the mechanism. In `src/main/exhibit/`:
  `import mermaidJs from 'mermaid/dist/mermaid.min.js?asset'`,
  `import exhibitCss from './assets/exhibit.css?asset'`,
  `import interWoff2 from '../../renderer/src/assets/fonts/InterVariable.woff2?asset'`.
  The handler maps `exhibit://lib/<name>` to those paths. To verify in the
  build issue: that Vite resolves a bare `mermaid/dist/...?asset` specifier
  through `externalizeDepsPlugin()` (it externalises `import 'mermaid'`, but
  an asset import is a file resolution, not a module import — if it does not,
  a relative path into `node_modules` works).
- The `resources/` public dir is the wrong place: "All assets in public
  directory are not copied to output directory" for main/preload, and the
  kiosk image's runtime stage copies only `out/`, `node_modules/` and
  `package.json` (`Dockerfile` lines 110–112). Anything not under `out/`
  does not reach the kiosk without a Dockerfile change.
- Mermaid goes in `devDependencies`: `?asset` copies the file into `out/`,
  so nothing resolves it at runtime. The image does not prune dev deps
  (`COPY --from=builder /app/node_modules`), so the kiosk image will also
  carry `node_modules/mermaid` (3.5 MB min + 8.3 MB unminified + 13 MB maps)
  regardless — a pre-existing image-size matter, not an Exhibit one.
- Do not make the Exhibit sheet a renderer input: the renderer target hashes
  and inlines for `index.html`/`overlay.html`, and the Exhibit page is not
  built by Vite at all — it is model output served raw.

## Size budget

### Shipped

| asset | bytes |
| --- | ---: |
| `mermaid.min.js` | 3,572,661 |
| `InterVariable.woff2` (regular, second copy) | 352,240 |
| `exhibit.css` (minified) | ~6,000 |
| `exhibit.js` (minified) | ~2,600 |
| **total** | **~3.93 MB** |

Against today's `out/`: renderer 1,766,506 B, main 557,541 B, preload
13,287 B — the Exhibit bundle is ~1.7× the whole current build, and 91% of
it is Mermaid. Dropping Inter saves 352 KB; dropping Mermaid is the only
change that matters, and the map already decided Mermaid stays. If size
ever bites: mermaid's `dist/chunks/mermaid.esm.min` lets a future build
serve only the flowchart/sequence/pie chunks (~1.5 MB) — an ESM entry with
`import()` from `exhibit://lib/chunks/…` works over a `standard` scheme.

### Per-Exhibit HTML

The stub — header, one candidate card with a before/after Mermaid pair,
a 4-row comparison table, a 4-bar chart, a three-tab section with a
collapsible — is **19,739 B** with the sheet and runtime inlined, i.e.
**7,543 B of model-authored HTML** when those come from `exhibit://lib/`.

Bounds the render call should enforce:

- **Hard cap 64 KB** (65,536 B of UTF-8) on the returned HTML: reject the
  Exhibit and keep the Card (the map's fallback). Well below anything the
  view struggles with; the binding limit is the model, not Chromium.
- **Prompt for ≤ 24 KB** and pass `max_tokens ≈ 16k` on the render call
  (HTML tokenises at ~3–4 bytes per token, so 64 KB ≈ 16–20k tokens).
  `openAiLlmClient.ts` sets no `max_tokens` today; the render call must,
  because a runaway generation is otherwise bounded only by the 120 s
  request timeout.
- **Latency is the real budget.** At 24 KB ≈ 6–8k output tokens, the
  "laying out" state lasts 30–80 s depending on the model's token rate —
  long enough that the Exhibit brief and the first-paint ordering matter
  more than bytes. The Card is on screen the whole time, so nothing is
  blocked, but the criteria ticket should treat 24 KB as generous, not
  typical.
- Mermaid's own guards stand: `maxTextSize` 50,000 chars per diagram,
  `maxEdges` 500. Leave the defaults.

## Open risks

- **Theme re-render flashes.** On appearance change the runtime re-runs
  Mermaid (~30 ms/diagram); the diagrams blink once. Acceptable for a
  Setting change; not a hot path.
- **`color-mix()` tints** need Chrome ≥ 111 — Electron 43 is Chrome 150,
  fine, but the tints diverge from the dashboard's hand-picked fills if the
  palette ever changes; option 1 above (shared `tokens.css`) keeps them
  tracking.
- **Model-authored `<script>` is refused by the CSP silently.** The model
  must be told the runtime's hooks; an Exhibit that relies on its own JS
  will render static. A render-call lint (`<script` in the output → reject
  or strip) turns the silent failure into a visible one.
- **`?asset` from `node_modules`** through `externalizeDepsPlugin` is
  asserted from the docs, not built here. First task of the build issue.
- **Memory on the Hardware Floor**: one more renderer process while an
  Exhibit is open. Measure RSS in the surface ticket's prototype with
  `--disable-gpu`; if it hurts, the view is created on Exhibit arrival and
  destroyed on close rather than kept warm.
- **Font-scale Setting** reaches the Exhibit only if the handler injects it
  (`<html style="--font-scale: …">`); without that the Exhibit ignores the
  accessibility Setting the panel honours.

## Sources

- mermaid 11.17.2 package: `dist/mermaid.min.js`, `dist/mermaid.esm.min.mjs`,
  `dist/chunks/mermaid.esm.min/`, `dist/config.type.d.ts` (`securityLevel`,
  `htmlLabels`, `fontFamily` typedocs); sizes from `ls -l`, gzip from
  `gzip -9`.
- mermaid usage docs, `securityLevel` values and the sandbox iframe:
  https://mermaid.js.org/config/usage.html
- Electron `protocol` API (privileges list, `registerSchemesAsPrivileged`
  before ready, per-session `handle`, `net.fetch(pathToFileURL(...))`):
  https://www.electronjs.org/docs/latest/api/protocol
- Electron security guide (CSP header vs meta, sandbox, contextIsolation):
  https://www.electronjs.org/docs/latest/tutorial/security
- Electron `webContents.loadURL` options (`baseURLForDataURL`,
  `will-navigate`, `setWindowOpenHandler`):
  https://www.electronjs.org/docs/latest/api/web-contents
- electron-vite asset handling (`?asset`, public dirs, what is copied):
  https://electron-vite.org/guide/assets
- Repo: `src/renderer/src/styles.css` (tokens 28–83), `overlay.css`,
  `src/main/attachAppearance.ts`, `src/main/attachGpuStability.ts`,
  `src/main/browser/createBrowserPane.ts`, `src/main/browser/attachAdblock.ts`,
  `src/main/panel/createFeedPanelOverlay.ts`, `electron.vite.config.ts`,
  `Dockerfile`, `docs/adr/0012`, `0020`, `0023`; the Pocock reference
  `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.3/skills/engineering/improve-codebase-architecture/HTML-REPORT.md`.
- Probe: an Electron main script registering the `exhibit` scheme, serving
  the page and `mermaid.min.js`, loading it in a sandboxed `BrowserWindow`
  under Xvfb and reading back SVG count, timings and `console-message` CSP
  violations; run with and without `--disable-gpu` and with
  `nativeTheme.themeSource = 'dark'`. Not checked in (throwaway, depends on
  a local `npm install mermaid@11 chart.js uplot`).
