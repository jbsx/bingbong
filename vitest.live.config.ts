import { defineConfig } from 'vitest/config'

// The opt-in live-web pilot config (#225): the only config that matches
// `*.live.test.ts`. It spends real model budget against production routing
// AND browses the live web, so it never rides `pnpm test`, `pnpm test:e2e`,
// `pnpm test:eval`, or CI — the unit config excludes the pattern explicitly
// and e2e/eval/delegation each match a different one.
//
// Same Xvfb rule as every other Electron suite (the pnpm script wraps it),
// and one app at a time: each hunt launches its own app on its own benchmark
// profile, and two at once would fight over OS focus for synthetic input.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/live/**/*.live.test.ts'],
    fileParallelism: false,
    // A pass is four live-web hunts run sequentially at production effort
    // limits, plus two follow-ups. The pass owns its own per-attempt bounds
    // (the capture's `bounds`); this is only the outer guard rail, sized so
    // it can never be what stops a pass.
    testTimeout: 4 * 60 * 60_000,
    hookTimeout: 5 * 60_000,
  },
})
