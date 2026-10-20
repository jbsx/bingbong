// Scriptlets (the `##+js(...)` rules: set-constant, json-prune, the
// inbound-object edits) only work when they run before the page's own
// scripts — YouTube reads its player response, ad slots and all, while the
// document is still parsing. The library injects them with
// webContents.executeJavaScript, which Electron holds until the page has
// finished loading, so every one ran too late and the ads played. They run
// from our own frame preload instead (adblockScriptletsPreload.cjs), which
// asks main for them on this channel and executes them before any page script.

/** Sync IPC: the preload sends the frame's URL, main returns its scriptlets. */
export const ADBLOCK_SCRIPTLETS_CHANNEL = 'bingbong/adblock/scriptlets'

/**
 * One assembled scriptlet, wrapped in its own function scope. The library
 * concatenates each scriptlet's dependencies at the top level, and some are
 * lexical declarations (`class JSONPath{…}` behind every inbound-object
 * edit): run bare in one page, the second scriptlet sharing a dependency dies
 * on "Identifier 'JSONPath' has already been declared" and never applies.
 */
export function isolateScriptlet(script: string): string {
  return `(() => {\n${script}\n})()`
}
