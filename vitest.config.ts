import { defineConfig } from 'vitest/config'

// pool: 'vmThreads' is a workaround — the default pools crash with
// "Cannot read properties of undefined (reading 'config')" in this environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'vmThreads',
  },
})
