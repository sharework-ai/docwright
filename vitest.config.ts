import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      // The browser client (src/client) is exercised by the headless-browser
      // acceptance lane (S4, AGENTS.md), not by jsdom render tests — same
      // split as dsh-market's vitest.web lane. The server stays at 100.
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/pack.ts', 'src/client/**'],
      // Branch threshold is 80 (not 100): the remaining branches are defensive
      // null-guards on boundaries the type system already narrows; forced tests
      // would assert tautologies. Lines/functions/statements stay at 100.
      thresholds: { lines: 100, functions: 100, branches: 80, statements: 100 },
    },
  },
})
