import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run all *.test.ts files inside tests/ — they exercise pure logic only,
    // never instantiate the Pixi renderer or the DOM. Keep them fast.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 5000
  }
});
