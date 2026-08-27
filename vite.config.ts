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
    // `e2e/**` usa o runner do Playwright (`npm run test:e2e`), não o do
    // Vitest — sem isto, `dealer-flow.spec.ts` bateria no glob padrão de
    // teste do Vitest (`*.spec.ts`) e falharia por usar `test`/`expect` do
    // `@playwright/test`, não os globals do Vitest.
    exclude: ['**/node_modules/**', 'e2e/**'],
    setupFiles: ['./vitest.setup.ts'],
    // Os testes de integração de api/ fazem várias idas ao PGlite em
    // sequência de propósito (decrypt/transição de estado precisam ser
    // sequenciais, ver comentários em api/applications/[id].ts e
    // api/bureau/check.ts) — sob instrumentação de cobertura (v8) isso passa
    // dos 10s padrão em alguns arquivos maiores. Subiu de 20s pra 40s na
    // Fase 6: mais arquivos de teste rodando em paralelo (reveal, audit-log,
    // os dois crons) aumenta a contenção de CPU da própria instrumentação,
    // não o tempo de execução de cada teste isoladamente.
    testTimeout: 40000,
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
      exclude: ['src/test/**', 'src/**/main.tsx', 'src/**/*.d.ts', 'api/**/*.test.ts'],
    },
  },
})
