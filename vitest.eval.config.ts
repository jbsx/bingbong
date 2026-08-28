import { defineConfig } from 'vitest/config'

// The opt-in real-model evaluation config (#109): separate from
// vitest.e2e.config.ts on purpose — this suite spends real model budget
// against production routing and must never ride `pnpm test:e2e`. Same
// Xvfb rule though: the pnpm script wraps xvfb-run, one app at a time,
// with timeouts sized for unattended multi-minute model runs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/eval/**/*.eval.test.ts'],
    // One Electron app whose synthetic input needs OS focus — never parallel.
    fileParallelism: false,
    // Per-scenario wall budgets live inside the evaluator (it aborts and
    // records timeouts); these are the outer guard rails.
    testTimeout: 20 * 60_000,
    hookTimeout: 120_000,
  },
})
