import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    // E2e runs under its own Xvfb-wrapped config; the real-model evaluation
    // suite (#109), the delegation probe (#163) and the live-web pilot (#225)
    // are opt-in only — they must never ride the unit suite. The live-web
    // pattern is the costly one: it browses the real web on real budget, so
    // e2e/live/config.test.ts asserts this exclusion rather than trusting it.
    exclude: [
      ...configDefaults.exclude,
      'e2e/**/*.e2e.test.ts',
      'e2e/**/*.eval.test.ts',
      'e2e/**/*.probe.test.ts',
      'e2e/**/*.live.test.ts',
      // The live-access preflight (#227) browses the real web. It spends no
      // model budget, but it contacts live sites, so it is opt-in for the
      // same reason and asserted in the same place.
      'e2e/**/*.preflight.test.ts',
    ],
  },
})
