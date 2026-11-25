import { defineConfig } from 'vitest/config'

// pool: 'vmThreads' is a workaround — the default pools crash with
// "Cannot read properties of undefined (reading 'config')" in this environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'vmThreads',
    coverage: {
      // Count every source file, not only the ones a test happens to import.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/ui/testDom.ts'],
    },
  },
})
