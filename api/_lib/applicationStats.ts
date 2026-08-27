import { sql } from 'drizzle-orm'
import type { Db } from './db'
import { applications, type ApplicationStatus } from './schema'

// Mesmos agrupamentos usados pelos chips da fila (Fase 10, movidos pro
// backend na Fase 12) — extraídos de `api/applications/index.ts` nesta fase
// pra serem reaproveitados também pelo dashboard de métricas (Fase 18), em
// vez de duplicar a mesma classificação de status em dois lugares.
export const REVIEW_STATUSES = new Set<ApplicationStatus>([
  'manual_review',
  'documents_review_required',
])
export const SUCCESS_STATUSES = new Set<ApplicationStatus>([
  'approved',
  'offer_created',
  'offer_sent',
  'offer_accepted',
])
export const CLOSED_STATUSES = new Set<ApplicationStatus>([
  'denied',
  'offer_declined',
  'cancelled',
  'expired',
])

export interface ApplicationStatusCounts {
  total: number
  reviewing: number
  approved: number
  closed: number
}

/** Contagem por status sobre a tabela inteira (nunca filtrada) — um `GROUP BY` só. */
export async function getApplicationStatusCounts(db: Db): Promise<ApplicationStatusCounts> {
  const rows = await db
    .select({ status: applications.status, count: sql<number>`count(*)::int` })
    .from(applications)
    .groupBy(applications.status)

  let total = 0
  let reviewing = 0
  let approved = 0
  let closed = 0
  for (const row of rows) {
    total += row.count
    if (REVIEW_STATUSES.has(row.status)) reviewing += row.count
    if (SUCCESS_STATUSES.has(row.status)) approved += row.count
    if (CLOSED_STATUSES.has(row.status)) closed += row.count
  }
  return { total, reviewing, approved, closed }
}
