import { defineConfig } from 'vitest/config'

// The opt-in live-access preflight config (#227): the only config that
// matches `*.preflight.test.ts`.
//
// It spends NO model budget — nothing is submitted to the app, and the
// evaluator drives the browser pane directly. But it contacts live websites,
// so it never rides `pnpm test`, `pnpm test:e2e` or CI, for the same reason
// the pilot does not: a suite that reaches the public internet should be run
// deliberately, by someone who meant to.
//
// It is kept OUT of `vitest.live.config.ts` on purpose. That config runs the
// paid pilot, and the preflight's whole job is to happen *before* the pilot
// and decide whether it should run at all. Sharing an entry point would make
// "check the sources first" and "spend the budget" one command.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/live/**/*.preflight.test.ts'],
    // One app at a time: synthetic input goes to whichever window has OS
    // focus, the same rule every other Electron suite here follows.
    fileParallelism: false,
    // Nine live pages, each allowed to be slow, on a browser that may be
    // waiting out a consent script. The per-navigation bounds inside the
    // suite are what actually stop it; this is only an outer guard rail.
    testTimeout: 45 * 60_000,
    hookTimeout: 5 * 60_000,
  },
})
