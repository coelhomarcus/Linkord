import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
      '/uploads': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    // jsdom (nao 'node') pra poder montar componente React de verdade (RTL) —
    // da tambem localStorage/document de graca pros testes de preferencias
    // (useSettingsPreference.ts etc.), sem precisar de stub manual.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // so roda com `npm run test:coverage` (--coverage) — o dia a dia
    // (`npm run test`) fica rapido sem instrumentar nada.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
