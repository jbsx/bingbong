import { defineConfig } from 'vitest/config'

// The #163 delegation probe's config — its own file, not a flag on
// vitest.eval.config.ts, so the release capture (#132) can never pick these
// scenarios up. `pnpm test:eval` includes `e2e/eval/**/*.eval.test.ts`; the
// probe is `*.probe.test.ts` and rides nothing else. Same Xvfb rule and the
// same unattended multi-minute timeouts as the eval suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/eval/**/*.probe.test.ts'],
    fileParallelism: false,
    testTimeout: 20 * 60_000,
    hookTimeout: 120_000,
  },
})
