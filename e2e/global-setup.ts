import { rm } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const E2E_DATA_DIR = path.resolve(here, '../.pglite-data-e2e')

/**
 * Roda uma vez, antes de qualquer teste (e antes do dev server subir de
 * vez — ver `webServer` em `playwright.config.ts`). Semeia um PGlite
 * isolado, **nunca** o `.pglite-data` de desenvolvimento — os testes
 * criam seus próprios dados via chamadas reais à API (ver `helpers.ts`),
 * não dependem do conteúdo do seed de demo; ele só existe aqui pra criar o
 * usuário dealer (`dealer@credpronto.dev`), sem o qual não haveria como
 * logar num banco recém-migrado.
 *
 * Reaproveita `scripts/seed.ts` (o mesmo do `npm run db:seed`) como
 * processo filho separado, em vez de importar `getDb()` neste processo do
 * test runner — mesmo cuidado já documentado no CLAUDE.md pra nunca ter
 * duas escritas concorrentes no mesmo arquivo PGlite: este processo abre,
 * semeia e fecha antes do dev server (outro processo) sequer tentar abrir
 * o mesmo arquivo.
 */
export default async function globalSetup(): Promise<void> {
  await rm(E2E_DATA_DIR, { recursive: true, force: true })
  // `DATABASE_URL` removida de propósito — se por acaso estiver definida no
  // ambiente (ex.: sessão de terminal apontando pra um Postgres real),
  // `getDb()` a preferiria sobre PGlite e ignoraria `PGLITE_DATA_DIR` por
  // completo. A suíte E2E nunca deve escrever num banco que não seja o
  // descartável dela mesma.
  const env = { ...process.env, PGLITE_DATA_DIR: E2E_DATA_DIR }
  delete env.DATABASE_URL
  execSync('npx tsx scripts/seed.ts', {
    cwd: path.resolve(here, '..'),
    env,
    stdio: 'inherit',
  })
}
