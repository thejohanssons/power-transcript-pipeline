import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Most tests run in node environment (API, fixtures, feedback logic)
    // Browser DOM tests use jsdom and are in *.browser.test.ts files
    environment: 'node',
    globals: false,
    environmentMatchGlobs: [
      ['**/*.browser.test.ts', 'jsdom'],
    ],
  },
});
