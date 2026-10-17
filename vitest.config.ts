import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    // E2e runs under its own Xvfb-wrapped config. The `*.chrome.test.ts`
    // collector tests stay here: they drive a headless Chrome and skip
    // themselves when none is installed.
    exclude: [...configDefaults.exclude, 'e2e/**/*.e2e.test.ts'],
  },
})
