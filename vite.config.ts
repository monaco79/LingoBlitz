/// <reference types="vitest/config" />

import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
    include: [
      'services/**/*.test.{ts,tsx}',
      'components/**/*.test.{ts,tsx}',
      '*.test.tsx',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
