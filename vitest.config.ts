import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
  },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
