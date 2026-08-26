/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { apiDevPlugin } from './vite.api-plugin'
import { portalDevPlugin } from './vite.portal-plugin'

export default defineConfig({
  plugins: [react(), apiDevPlugin(), portalDevPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      input: {
        dealer: fileURLToPath(new URL('./dealer.html', import.meta.url)),
        client: fileURLToPath(new URL('./client.html', import.meta.url)),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentMatchGlobs: [['api/**', 'node']],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
      exclude: ['src/test/**', 'src/**/main.tsx', 'src/**/*.d.ts', 'api/**/*.test.ts'],
    },
  },
})
