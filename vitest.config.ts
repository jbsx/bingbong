import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    // E2e runs under its own Xvfb-wrapped config; the real-model evaluation
    // suite (#109) and the delegation probe (#163) are opt-in only — they
    // must never ride the unit suite.
    exclude: [
      ...configDefaults.exclude,
      'e2e/**/*.e2e.test.ts',
      'e2e/**/*.eval.test.ts',
      'e2e/**/*.probe.test.ts',
    ],
  },
})
