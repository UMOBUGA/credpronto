import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as schema from './schema'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.resolve(here, '../../drizzle')

export type Db = Awaited<ReturnType<typeof openPostgres>> | Awaited<ReturnType<typeof openPglite>>

async function openPostgres(url: string) {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const postgres = (await import('postgres')).default
  const client = postgres(url)
  return drizzle(client, { schema })
}

/**
 * Sem `DATABASE_URL`, roda contra Postgres embutido em WASM (PGlite) num
 * arquivo local. É isso que garante `npm install && npm run dev` funcionando
 * sem nenhuma configuração — mesma promessa do painel-do-ar, que este projeto
 * reaproveita. Migra automaticamente por ser um banco descartável de
 * desenvolvimento; produção migra explicitamente via `npm run db:migrate`.
 */
async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  // Em teste, cada arquivo de teste roda em seu próprio worker; um caminho de
  // arquivo compartilhado causaria os workers disputando o mesmo banco em
  // paralelo. `memory://` dá a cada um uma instância isolada e descartável.
  const client = process.env.VITEST
    ? new PGlite('memory://')
    : new PGlite(path.resolve(here, '../../.pglite-data'))
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return db
}

let dbPromise: Promise<Db> | null = null

export function getDb(): Promise<Db> {
  dbPromise ??= process.env.DATABASE_URL ? openPostgres(process.env.DATABASE_URL) : openPglite()
  return dbPromise
}
