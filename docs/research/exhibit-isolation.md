# Exhibit isolation mechanics — research for #170 (map #169)

> **Question.** How does Bing Bong render model-authored HTML+JS *fully
> isolated* — no preload, no IPC, no Bing Bong globals — with navigation as
> the only egress, routed into the browsing pane?
>
> **Answer in one line.** A dedicated, sandboxed `WebContentsView` with no
> preload, on its own in-memory session partition, loading the page over a
> privileged app scheme (`exhibit://`) whose `protocol.handle` response
> carries the CSP header; `will-frame-navigate` + `setWindowOpenHandler` +
> `will-download` are the complete egress set, and the href goes straight to
> `BrowserPane.navigate` in main. Cost: one extra renderer process
> (~40 MB PSS measured under software compositing) — which the iframe option
> pays too, since Chromium ≥127 isolates sandboxed iframes into their own
> process.

Researched 2026-09-03 against **Electron 43.4.0 / Chromium 150.0.7871.224**
(the version `package.json` pins and `node_modules` resolves). Sources are
Electron's docs at the `v43.4.0` tag, Chromium's process-model doc, this
codebase, and two throwaway probe scripts run under Xvfb with
`--no-sandbox` (how the kiosk container runs Electron, ADR 0023) — their
results are tabulated below and the method is described so they can be
re-run. Nothing in `src/` was modified.

---

## 1. Where the precedent views stand

| View | File | `sandbox` | `preload` | Session | Navigation policy |
| --- | --- | --- | --- | --- | --- |
| Dashboard window | `src/main/index.ts` (`createWindow`) | `false` | yes | default | app page |
| Feed Panel overlay | `src/main/panel/createFeedPanelOverlay.ts` | `false` | yes | default | app page (`overlay.html`); reload chords blocked (ADR 0017) |
| Browser pane | `src/main/browser/createBrowserPane.ts` | `true` | none | `persist:browse` | free; `setWindowOpenHandler` denies popups and reports them; auth popups deny-and-open (ADR 0018) |
| Subagent panes | `src/main/browser/subagentPanePool.ts` | `true` | none | `persist:browse` | free; popups denied and reported |

Three facts from these files shape the Exhibit:

- **The pane already runs the exact configuration the Exhibit wants** —
  `sandbox: true, contextIsolation: true, nodeIntegration: false`, no
  preload — and drives egress from main with `setWindowOpenHandler`. The
  Exhibit is that recipe plus a private partition, a scheme, a CSP, and a
  deny-everything navigation policy.
- **The navigate seam is `BrowserPane.navigate(input)`**
  (`createBrowserPane.ts`): `normalizeUrlInput` then `wc.loadURL`. Renderers
  reach it over IPC `browser:navigate` (`src/core/browser/ipcChannels.ts` →
  `registerBrowserIpc` in `src/main/browser/attachBrowserPane.ts` →
  `window.bingbong.browser.navigate` in `src/preload/index.ts`), which is
  how `FeedMarkdown.tsx` sends Card links to the pane. Main holds the `pane`
  object directly in `createWindow`, so the Exhibit needs **no IPC at all**:
  its navigation handler calls `pane.navigate(url)`.
- **Theme already reaches preload-less pages.** ADR 0020 /
  `attachAppearance.ts` set `nativeTheme.themeSource`, so every webContents
  reports the resolved `prefers-color-scheme`; `paneBackgrounds.ts` paints
  the native canvas behind a view via `trackPaneBackground(view)`. Both
  apply to the Exhibit unchanged (measured below).

The dashboard and overlay renderers run `sandbox: false` with a preload that
holds `ipcRenderer` (Electron: "the environment presented to the `preload`
script is substantially more privileged than that of a sandboxed renderer"
[sandbox]). Anything that puts model-authored script *inside* those
renderers inherits that risk; that is the case against the iframe.

## 2. The three options

| | **A. Sandboxed `WebContentsView`, app scheme** (recommended) | **B. `<iframe sandbox srcdoc>` in the overlay renderer** | **C. `<webview>`** |
| --- | --- | --- | --- |
| Process | Own renderer, own site (measured: new pid, ~40 MB PSS) | **Also** its own renderer: Chromium ≥127 puts sandboxed frames without `allow-same-origin` in a separate process [psi]; measured new pid, ~35 MB PSS | Own renderer (guest WebContents) |
| Process privilege | OS-sandboxed (where the OS sandbox exists), no Node | Child of a `sandbox: false` WebContents — unsandboxed process class, in a page whose main frame holds a preload with `ipcRenderer` | Own WebContents; host page must enable `webviewTag`, and a `<webview>` `preload` runs **with node integration** [wp] |
| Globals visible to the page | none (measured: `electron`, `require`, `process`, `bingbong` all `undefined`) | none *if* `contextIsolation` holds (it does today) — but the escape surface is the overlay's preload world | none, if no preload attribute |
| CSP delivery | **HTTP header** from the scheme handler (measured enforced) | `<meta>` inside the srcdoc, or the `csp` attribute; no header path; inherits nothing useful from the overlay (which has no CSP today) | `<meta>` or `webRequest` on its partition |
| Egress hooks in main | `will-frame-navigate`, `setWindowOpenHandler`, session `will-download`, permission handlers — all first-class, all measured | Link clicks navigate the *iframe* (interceptable via the overlay's `will-frame-navigate`, `isMainFrame=false`); `window.open` without `allow-popups` is dropped silently in the renderer — main never sees the href, the click goes nowhere; with `allow-popups` it reaches the overlay's open handler | `new-window` event removed with "no direct replacement" [breaking]; must find the guest `webContents` from main (`will-attach-webview`/`did-attach-webview`) to set a handler |
| Bundled libs, offline | `exhibit://bundle/mermaid.min.js` etc., relative URLs resolve (standard scheme) | Must be reachable from an opaque-origin srcdoc frame; the overlay is `file://` in production (`loadFile(overlay.html)`), so the libs need an app scheme anyway | Same as A, via `src`/`partition` |
| Theme tokens | `prefers-color-scheme` via `nativeTheme` + served `design.css` | Inline the tokens into the srcdoc — easiest of the three | Same as A |
| Crash visibility | `render-process-gone` on the view's webContents (measured, recoverable by `reload()`) | A subframe process dying is not the overlay's `render-process-gone`; the Feed would have to detect a sad-frame itself | `render-process-gone` DOM event on the tag |
| Layout | A rect the overlay (or dashboard) reports → `setBounds`, the existing `reportRect` seam; cannot scroll *inside* a Feed Entry | Lives in the Feed's DOM: inline in the Feed Entry, scrolls with it — the one real win | DOM element like B, but composited as a guest |
| Electron's stance | The documented way to display untrusted content: "use the `<webview>` tag or a `WebContentsView` and make sure to disable `nodeIntegration` and enable `contextIsolation`" [security §Isolation] | Not warned against; a normal web pattern | "We currently recommend to not use the `webview` tag" — undergoing "dramatic architectural changes" affecting rendering, navigation, event routing [webview] |

**Verdict.** A. The iframe's only advantage (inline in the Feed Entry) does
not match the map's standing decisions — the Exhibit *supersedes the Card
in the view*, auto-shows, and is re-opened from its Feed Entry, i.e. it is
a surface, not a Card body — and it buys no process saving while spending
the isolation boundary Electron explicitly recommends. `<webview>` costs
the same process as A, adds guest-view plumbing in the overlay renderer,
loses the `new-window` hook, and is deprecated in spirit by its own docs.

### Why an app scheme, not a `data:`/`blob:` URL

`loadURL('data:text/html,…')` from main works (the subagent pool uses it
for its placeholder paint), but for an Exhibit it fails on four counts:
opaque origin, so **relative URLs to bundled libraries do not resolve**
(Mermaid would be inlined into every page); **CSP only via `<meta>`**; web
storage throws on an opaque origin; and Chromium caps a navigable URL at
2 MB. A `blob:` URL can only be minted inside a renderer, and no renderer of
ours should touch the model's HTML. A privileged standard scheme gives
relative resolution, storage, and a header CSP [protocol].

## 3. The recommended option, mechanism by mechanism

### 3.1 Scheme, partition, serving

- `protocol.registerSchemesAsPrivileged([{ scheme: 'exhibit', privileges:
  { standard: true, secure: true } }])` **before `app.ready`**, called once
  [protocol]. `standard` is what makes relative URLs and web storage work;
  `secure` makes it a secure context (clipboard and friends behave like
  https). **Do not** set `bypassCSP`, `supportFetchAPI`, or `corsEnabled` —
  the page has nothing to fetch.
- `session.fromPartition('exhibit')` — **no `persist:` prefix, so it is
  in-memory** [session]: nothing outlives the app, and `clearStorageData()`
  at Lapse/Reset empties whatever `localStorage` an Exhibit wrote.
- A protocol is registered per session, so the handler goes on **that**
  session: `ses.protocol.handle('exhibit', handler)` after ready [protocol].
- URL layout: `exhibit://bundle/<asset>` for static shipped files
  (`design.css`, `mermaid.min.js`, fonts) served with
  `net.fetch(pathToFileURL(join(resourcesDir, asset)))` behind a
  path-escape check exactly as Electron's own `protocol.handle` example
  does [protocol]; `exhibit://answer/<runId>/` for the one HTML document of
  an Exhibit, read from an in-memory `Map<runId, string>` that the Session
  owns and clears. Anything else → 404.
- The handler **wraps** the model's HTML rather than trusting it to include
  the head: it prepends `<link rel="stylesheet"
  href="exhibit://bundle/design.css">` (and the Mermaid `<script>` only when
  the document contains a `.mermaid` block — parsing a multi-MB library on
  the Floor for a page that has no diagram is waste). A malformed `<head>`
  from the model cannot remove either.

### 3.2 CSP — header from the scheme handler

Electron "respects the `Content-Security-Policy` HTTP header"; the `<meta>`
form is the fallback for `file://`, where no header exists [security §7].
With `protocol.handle` the header is simply a response header on the
`Response` we return — no `webRequest.onHeadersReceived` needed (and note
the adblocker already owns the one `webRequest` listener slot per event on
the browse partition, ADR 0018; the exhibit partition is separate, so that
constraint never bites here).

Measured policy (enforced — the probe saw `securitypolicyviolation` events
and console errors for each blocked load):

```
default-src 'none';
script-src exhibit://bundle 'unsafe-inline';
style-src  exhibit://bundle 'unsafe-inline';
img-src    exhibit://bundle data:;
font-src   exhibit://bundle;
connect-src 'none'; form-action 'none'; base-uri 'none';
frame-src 'none'; object-src 'none'
```

`'unsafe-inline'` for scripts is deliberate: the model's inline `<script>`
*is* the Exhibit's interactivity, and it is the very thing the process
boundary exists to contain. The CSP's job is not to gate the author but to
make **network egress impossible**: `img`, `fetch`, form posts, subframes,
and objects all blocked; only `exhibit://bundle` and `data:` may be loaded.
Verify once that the bundled Mermaid build runs without `'unsafe-eval'`
(expected — it does not `eval`; flagged for the build issue). `frame-src
'none'` means no subframes, so `will-frame-navigate` and `will-navigate`
coincide in practice.

### 3.3 Navigation — the only egress, routed to the pane

What fires in main for each thing a model page can do, **measured** on a
sandboxed, preload-less view served over `exhibit://` (probe under Xvfb):

| Page action | Main-side hook that fired | Outcome |
| --- | --- | --- |
| click `<a href="https://…">` | `will-frame-navigate` (prevented → `will-navigate` is not reached) | route href to `pane.navigate` |
| `location.href = 'https://…'` | `will-frame-navigate` | same |
| `location.href = 'exhibit://bundle/other.html'` | `will-frame-navigate` | deny (an Exhibit is one page) |
| click `<a href="mailto:…">` | `will-frame-navigate` with the `mailto:` URL | deny (`normalizeUrlInput` would reject it anyway; nothing reaches the OS) |
| `window.open('https://…')` | `setWindowOpenHandler`, `disposition=foreground-tab`; page receives **`null`** | route href to `pane.navigate`, `{ action: 'deny' }` |
| click `<a target="_blank">` | `setWindowOpenHandler` | same |
| click `<a download>` | **session `will-download`** | `event.preventDefault()` — a download is an egress the navigation hooks do not see |
| form `GET https://…` | CSP `form-action 'none'` blocks in the renderer | nothing reaches main |
| `<a href="#sec">` | `did-navigate-in-page` only | allow — in-page |
| `fetch`, `<img src=https://…>` | CSP violation | blocked in the renderer |

Docs: `will-navigate`/`will-frame-navigate` are emitted "when a user or the
page wants to start navigation", not for `loadURL` from main, and
`preventDefault()` cancels [wc]; `setWindowOpenHandler` is "called before
creating a window when a new window is requested by the renderer, e.g. by
`window.open()`, a link with `target="_blank"`, shift+clicking on a link, or
submitting a form with `<form target="_blank">`", and `{ action: 'deny' }`
cancels it [wc]; the `new-window` event this replaced was removed in
Electron 22 [breaking]; `will-download` on the session with
`preventDefault()` cancels the download [session].

The routing rule: **every navigation and every window request is denied on
the Exhibit and its URL is offered to `pane.navigate(url)`**, which already
normalizes and rejects non-http(s) input — the same function the Card's
links hit through IPC. Because main owns both objects there is no channel
for the page to speak on: the href is the whole message. Whether the pane
should also come to the front / the Exhibit close when a link is followed
is a surface decision for the spec, not a mechanics one.

### 3.4 Theme tokens and bundled libraries without a preload

- **Theme signal — nothing to do.** `attachAppearance` sets
  `nativeTheme.themeSource` from the Setting; every webContents in the app
  reports the resolved `prefers-color-scheme` (ADR 0020; measured: the
  Exhibit page's `matchMedia('(prefers-color-scheme: dark)')` follows it
  with no injection). Live changes propagate as a media-query change, which
  a query-string or a stamped `data-theme` attribute would not.
- **Native canvas.** `trackPaneBackground(view)` paints the view's own
  background in the theme color so the load never flashes white (the same
  call the pane and subagent views make).
- **Token sheet.** `exhibit://bundle/design.css` carries the `:root` tokens
  in a light block and a `@media (prefers-color-scheme: dark)` block. ADR
  0020 wants one source for the dark tokens (`styles.css`); the build issue
  should either extract the `:root` blocks from `styles.css` at build time
  or move them to a shared tokens file both sheets import. The model writes
  `var(--accent)`, never hex.
- **Libraries.** Mermaid ships in the app (not a dependency today —
  `package.json` has no `mermaid`) and is served from `exhibit://bundle/`,
  offline, adblocker-irrelevant (different partition). CDNs are out of
  scope by the map.
- **If main ever must push something into the page**, `webContents.insertCSS`
  and `executeJavaScript` are one-way main→page calls that grant the page
  nothing [wc]; the probe used `executeJavaScript` to drive the page and the
  page still saw no globals. Not needed for the current map.

### 3.5 What `sandbox: true` + no preload leaves open, and how each closes

| Surface | State without action | Close it with |
| --- | --- | --- |
| Node / Electron / `bingbong` globals | absent (measured) | nothing — no preload, sandboxed |
| `window.open` | reaches `setWindowOpenHandler`; page gets `null` | deny + route (§3.3) |
| `postMessage` | no `parent` (top-level view: `window.parent === window`), no `opener` (measured `null`) | nothing to talk to |
| Clipboard | `navigator.clipboard.writeText` raises `clipboard-sanitized-write`, `readText` raises `clipboard-read` as **permission requests to main** (measured, both with and without a user gesture). **Electron "will automatically approve all permission requests unless the developer has manually configured a custom handler"** [security §5], so a handler is required. | `ses.setPermissionRequestHandler(() => callback(false))` and `setPermissionCheckHandler(() => false)` on the exhibit session — denies clipboard, `media`, `geolocation`, `notifications`, `fullscreen`, `pointerLock`, `openExternal`, `fileSystem` in one place [session] |
| Downloads (`<a download>`, `Content-Disposition`) | proceeds | `ses.on('will-download', e => e.preventDefault())` [session] |
| External protocols (`mailto:`, `tel:`, custom) | arrive as navigations | denied in `will-frame-navigate`; `openExternal` permission denied too |
| `alert`/`confirm`/`prompt`/`beforeunload` dialogs | would show | `webPreferences.disableDialogs: true` [wp] |
| Audio / video autoplay | a page could play sound over TTS | `webContents.setAudioMuted(true)` (the Exhibit is silent by design); `autoplayPolicy: 'document-user-activation-required'` [wp] |
| Drag-drop a file/link onto the view | default off [wp] | leave `navigateOnDragDrop: false` |
| Spellcheck dictionary download | default on [wp] | `spellcheck: false` — no editable text, and the kiosk may be offline |
| Web storage | works on the standard scheme (measured `localStorage` ok) | in-memory partition; `clearStorageData()` at Session end |
| Keyboard | the view takes focus on click like the pane | `feedPanel.registerShortcut(wc)` for Ctrl/Cmd+Shift+F, `before-input-event` for Escape — the pane's precedent |
| `window.print()` | opens a print flow | low risk on a kiosk with no printer; note only |
| DevTools | only main can open them | nothing |

### 3.6 Crash handling

Measured: `wc.forcefullyCrashRenderer()` on the Exhibit emitted
`render-process-gone` with `reason: 'crashed', exitCode: 5`; the
`WebContents` was **not** destroyed, `isCrashed()` was `true`, the URL was
retained, and a plain `wc.reload()` brought the page back in a **new
process** (pid changed, title restored) within ~1.5 s. The event's
`reason` values are `clean-exit | abnormal-exit | killed | crashed | oom |
launch-failed | integrity-failure | memory-eviction` [rpgd]; on the Floor
`oom` and `memory-eviction` are the realistic ones for a runaway model
page.

Policy for the spec: on `render-process-gone`, reload **once** per Exhibit;
a second death (or `unresponsive` for more than a few seconds →
`forcefullyCrashRenderer()` then fall back) hides the view and the Feed
Entry reverts to the Card — "today's Answer path never breaks" holds
because the Card is always there. The docs warn that "some webContents
share renderer processes" so a forced crash may take others down [wc]; the
Exhibit's private partition and unique site gave it its own process in
every probe run, and nothing else lives on that partition.

### 3.7 Cost on the Hardware Floor

Method: Electron 43.4.0 under Xvfb (`gpu_compositing: disabled_software`,
i.e. the software path the crash-loop guard falls back to), `--no-sandbox`,
a `BrowserWindow` with a trivial page as the baseline, then one Exhibit —
a 40-section page with SVG, tables and an inline script — measured 4 s
after load with `app.getAppMetrics()` plus `/proc/<pid>/smaps_rollup`
(PSS = proportional share of shared pages; Private = pages only this
process holds). Dev box, not the kiosk; treat as ±20 %.

| Configuration | New process | New process PSS / Private | App-wide PSS delta | GPU process delta | Browser process delta |
| --- | --- | --- | --- | --- | --- |
| A. sandboxed `WebContentsView`, `exhibit://` | 1 renderer | 40.8 MB / 22.2 MB | **+43 MB** (180 → 223 MB) | +1.3 MB | +4.5 MB |
| A. same, `--disable-gpu` | 1 renderer | 40.3 MB / 21.7 MB | +43 MB | +1.1 MB | +4.8 MB |
| B. sandboxed srcdoc iframe in the window's renderer | **1 renderer** (site-isolated) | 34.7 MB / 16.9 MB | +35 MB | +1.0 MB | +1.2 MB |

Reading: the Exhibit costs about **1 % of the Floor's 4 GB** while shown,
and the iframe saves ~8 MB, not a process. Rendering cost under software
compositing is CPU raster per repaint of every *visible* view; a static
Exhibit repaints only on scroll/interaction, so the standing rule for the
Exhibit brief should be **no continuous animation** (CSS animations,
spinners) — that is where a second view would hurt an i3-7100U. Load of
the served page was ~50 ms after process start.

Lifecycle recommendation: **create the view lazily when the first Exhibit
of a Session lands, `webContents.close()` it when the Exhibit closes and
nothing replaces it** ("close that", Lapse, Reset) — the 40 MB is only
paid while an Exhibit is on screen, and a wedged page dies with its view.
Reuse the live view across Exhibits within a Session (`loadURL` the next
`exhibit://answer/<runId>/`), since each is a full navigation into a fresh
document anyway. Mermaid's parse/init time on a Floor-class CPU is
unmeasured (not installed yet) — a build-issue measurement, and the
reason the handler should inject the library only when a diagram is
present.

### 3.8 Placement and z-order

The view's bounds follow the existing seam: a renderer reports a slot rect
(`reportRect → setBounds`, the panel slot in `BrowserPane.tsx` /
`createFeedPanelOverlay.ts`), so an Exhibit can occupy either the panel's
region or the main browsing area (as reopened subagent panes do via
`mainPane.rect()`) with no new plumbing. One constraint from #57: parked
subagent views live as slivers on the window's **right edge, above the
overlay**, and need unoccluded pixels to get their first paint. A view
added later and covering that edge starves them. `View.addChildView(view,
index)` takes an insertion index [view] — insert the Exhibit directly
above the overlay and below the parked slivers, or keep the Exhibit's rect
1 px short of the right edge as the overlay effectively does.

## 4. API sketch (main process; not app source)

```ts
// src/main/index.ts — module top, before app.ready, once:
protocol.registerSchemesAsPrivileged([{ scheme: 'exhibit', privileges: { standard: true, secure: true } }])

// src/main/exhibit/createExhibitView.ts (sketch)
export const EXHIBIT_PARTITION = 'exhibit' // in-memory: no persist:

export function attachExhibitProtocol(ses: Electron.Session, deps: {
  bundleDir: string
  html: (runId: string) => string | undefined
}): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  ses.protocol.handle('exhibit', (request) => {
    const { host, pathname } = new URL(request.url)
    if (host === 'bundle') {
      const file = path.resolve(deps.bundleDir, '.' + pathname)
      const rel = path.relative(deps.bundleDir, file)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return new Response('', { status: 400 })
      return net.fetch(pathToFileURL(file).toString())
    }
    if (host === 'answer') {
      const html = deps.html(pathname.split('/')[1] ?? '')
      if (html === undefined) return new Response('', { status: 404 })
      return new Response(wrapExhibit(html), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': EXHIBIT_CSP },
      })
    }
    return new Response('', { status: 404 })
  })
}

export function createExhibitView(win: BrowserWindow, deps: {
  session: Electron.Session
  navigate: (url: string) => boolean      // pane.navigate — the seam
  onGone: (reason: string) => void        // second death → Card fallback
}): { view: WebContentsView; show(runId: string): void; dispose(): void } {
  const view = new WebContentsView({
    webPreferences: {
      session: deps.session,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      disableDialogs: true, spellcheck: false,
      autoplayPolicy: 'document-user-activation-required',
    },
  })
  trackPaneBackground(view)
  const wc = view.webContents
  wc.setAudioMuted(true)
  let current: string | null = null
  let reloaded = false

  wc.on('will-frame-navigate', (details) => {
    if (details.url === current) return           // our own reload
    details.preventDefault()
    deps.navigate(details.url)                    // normalizeUrlInput drops mailto: etc.
  })
  wc.setWindowOpenHandler(({ url }) => {
    deps.navigate(url)
    return { action: 'deny' }
  })
  wc.on('render-process-gone', (_e, details) => {
    if (!reloaded) { reloaded = true; wc.reload(); return }
    deps.onGone(details.reason)
  })
  wc.on('unresponsive', () => { wc.forcefullyCrashRenderer() })

  return {
    view,
    show(runId) {
      current = `exhibit://answer/${runId}/`
      reloaded = false
      void wc.loadURL(current)
    },
    dispose() {
      if (!win.isDestroyed()) win.contentView.removeChildView(view)
      if (!wc.isDestroyed()) wc.close()
    },
  }
}
```

Wiring in `createWindow`: `createExhibitView(win, { session:
session.fromPartition(EXHIBIT_PARTITION), navigate: (url) =>
pane.navigate(url), … })`, `feedPanel.registerShortcut(view.webContents)`,
insert with `win.contentView.addChildView(view, indexAboveOverlay)`, bounds
from a reported slot rect; Session end → `dispose()` +
`ses.clearStorageData()` + clear the HTML map.

## 5. Open risks and what the spec still has to decide

1. **Talk-back is genuinely closed.** With no preload there is no channel
   from the Exhibit to main except a URL. If the "Not yet specified"
   talk-back fog is ever lifted, the honest options are (a) a private
   scheme the page navigates to (`exhibit-action://dig/<candidateId>`),
   intercepted in `will-frame-navigate` like any link — no code in the
   page, one more URL shape to validate; or (b) a minimal preload with
   `contextBridge` — which reopens exactly the door this ticket closes.
   (a) fits the isolation stance; record it as the extension path.
2. **Permission default.** Electron grants permission requests when no
   handler is installed; the handler on the exhibit partition is not
   optional. Same for `will-download`.
3. **Mermaid on the Floor.** Init cost and whether it needs
   `'unsafe-eval'` are unmeasured; inject only when a diagram is present.
4. **Token single-source.** `design.css` duplicating `styles.css`'s `:root`
   blocks violates ADR 0020's "one source" unless the build extracts them.
5. **Z-order with parked subagent slivers** (§3.8) — pick insertion index
   or a 1 px margin in the surface ticket.
6. **`--no-sandbox` on the kiosk** (ADR 0023): inside the container the OS
   sandbox is off for every process; `sandbox: true` still removes Node
   from the renderer [sandbox], and the process boundary and CSP still
   hold. The Exhibit is no weaker than the pane there, but it is not
   OS-sandboxed either — the Chromium renderer is the boundary.
7. **Link-follow behaviour** (Exhibit stays / closes when a link navigates
   the pane) and **where the Exhibit sits** (panel region vs main area) are
   surface decisions; both are reachable with the same rect seam.

## Sources

Electron docs at tag `v43.4.0` (https://github.com/electron/electron/tree/v43.4.0/docs):

- [wc] `docs/api/web-contents.md` — `will-navigate`, `will-frame-navigate`,
  `did-create-window`, `render-process-gone`, `setWindowOpenHandler`,
  `forcefullyCrashRenderer`, `close`, `insertCSS`.
- [protocol] `docs/api/protocol.md` — `registerSchemesAsPrivileged`
  (before ready, once; standard/secure semantics), `protocol.handle`,
  per-session registration.
- [session] `docs/api/session.md` — `fromPartition` (in-memory without
  `persist:`), `will-download`, `setPermissionRequestHandler`,
  `setPermissionCheckHandler`, `ses.protocol`.
- [wp] `docs/api/structures/web-preferences.md` — `sandbox` (default true
  since Electron 20), `webviewTag` (default false; preload runs with node
  integration), `disableDialogs`, `autoplayPolicy`, `navigateOnDragDrop`,
  `spellcheck`.
- [sandbox] `docs/tutorial/sandbox.md` — sandboxed renderer semantics,
  preload privilege note, `--no-sandbox` still disables Node with
  `sandbox: true`, "rendering untrusted content" note.
- [security] `docs/tutorial/security.md` — §Isolation for untrusted
  content, §5 permissions (auto-approved by default), §7 CSP (header vs
  `<meta>`), §13 navigation, §14 new windows.
- [webview] `docs/api/webview-tag.md` — the Warning section.
- [breaking] `docs/breaking-changes.md` — `new-window` removed
  (Electron 22), sandbox default (Electron 20).
- [view] `docs/api/view.md` — `addChildView(view[, index])`.
- [rpgd] `docs/api/structures/render-process-gone-details.md`.
- [wo] `docs/api/window-open.md` — `window.open` returns `null` when the
  handler denies.

Chromium:

- [psi] `docs/process_model_and_site_isolation.md` (chromium/src, main) —
  "Sandboxed iframes … Since 127.0.6483.0, Desktop Chromium moves these
  documents into a separate process from their parent or opener"; `data:`
  URL process placement.

This repository (HEAD `40f7de0`): `src/main/index.ts`,
`src/main/panel/createFeedPanelOverlay.ts`,
`src/main/browser/createBrowserPane.ts`,
`src/main/browser/attachBrowserPane.ts`,
`src/main/browser/subagentPanePool.ts`, `src/main/attachAppearance.ts`,
`src/main/browser/paneBackgrounds.ts`, `src/main/attachGpuStability.ts`,
`src/preload/index.ts`, `src/renderer/src/FeedMarkdown.tsx`,
`src/core/browser/ipcChannels.ts`, `docker/entrypoint.sh`, ADRs 0004, 0009,
0017, 0018, 0020, 0023, `CONTEXT.md` (Views, Hardware).

Probes (throwaway, not committed): two Node scripts run with the pinned
Electron binary via `xvfb-run -a -s "-screen 0 1280x800x24" electron
<script> --no-sandbox [--disable-gpu]`: a memory probe (baseline window →
add view or iframe → `app.getAppMetrics()` + `/proc/<pid>/smaps_rollup`), an
egress probe (the page attempts each action in §3.3/§3.5 while main logs
every hook, then `forcefullyCrashRenderer` + `reload`). Results are the numbers quoted above.
