import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    // E2e runs under its own Xvfb-wrapped config; the real-model evaluation
    // suite (#109) is opt-in only — it must never ride the unit suite.
    exclude: [...configDefaults.exclude, 'e2e/**/*.e2e.test.ts', 'e2e/**/*.eval.test.ts'],
  },
})
