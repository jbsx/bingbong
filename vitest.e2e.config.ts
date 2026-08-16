import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    // Each file launches real Electron apps whose synthetic input needs OS
    // focus — parallel files fight over it and flake.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
})
