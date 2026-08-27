import { defineConfig, devices } from '@playwright/test'
import { E2E_DATA_DIR } from './e2e/global-setup'

/**
 * Porta dedicada, diferente da 5173 do `npm run dev` — evita colidir com um
 * servidor de desenvolvimento que o próprio dealer possa já ter aberto
 * (com o `.pglite-data` de demonstração dele, nada a ver com o banco
 * isolado da suíte E2E).
 */
const PORT = 5183

/**
 * Suíte formal de E2E (Fase 19) — antes disso, toda verificação em
 * navegador real deste projeto era um script `.mjs` ad-hoc fora de
 * controle de versão. Cobertura deliberadamente enxuta: 3 testes de
 * caminho crítico em `e2e/dealer-flow.spec.ts`, não uma reimplementação da
 * suíte de negócio que MSW/PGlite já cobrem em `npm test`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Sempre um servidor novo, nunca reaproveita um `npm run dev` que já
    // esteja rodando — esse outro processo apontaria pro `.pglite-data` de
    // desenvolvimento, não pro banco isolado que `globalSetup` acabou de
    // semear.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    env: {
      PGLITE_DATA_DIR: E2E_DATA_DIR,
      // `webServer.env` só adiciona a `process.env`, não substitui — se
      // `DATABASE_URL` estiver definida no ambiente (ex.: sessão apontando
      // pra um Postgres real), `getDb()` a preferiria sobre PGlite e
      // ignoraria `PGLITE_DATA_DIR`. String vazia é falsy o bastante pra
      // `getDb()` cair pro PGlite mesmo assim.
      DATABASE_URL: '',
    },
  },
})
