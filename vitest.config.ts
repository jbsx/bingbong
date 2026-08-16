import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**/*.e2e.test.ts'],
  },
})
