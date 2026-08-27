import { isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../_lib/db'
import { applications, creditDecisions } from '../_lib/schema'
import { requireDealerSession } from '../_lib/auth'
import { getApplicationStatusCounts } from '../_lib/applicationStats'
import { sendJson, type Handler } from '../_lib/http'

/**
 * Faixas do score do bureau simulado (`bureau.ts::checkBureauMock` sorteia
 * entre 300 e 900 — não é uma escala 0-100) alinhadas aos limiares que
 * `decision.ts` já usa: abaixo de 450 é a zona de negação automática, 700+ é
 * a zona de aprovação automática, o meio é a "zona cinzenta" que mais
 * provavelmente vira `manual_review`.
 */
const SCORE_BUCKETS = [
  { label: '300–449', min: 300, max: 450 },
  { label: '450–599', min: 450, max: 600 },
  { label: '600–749', min: 600, max: 750 },
  { label: '750–900', min: 750, max: 901 },
] as const

/**
 * Dashboard agregado (Fase 18) — só números, nenhuma PII, aberto a qualquer
 * papel autenticado (diferente de `reveal.ts`, que exige admin/manager: não
 * há nada sensível aqui pra restringir). Reaproveita
 * `getApplicationStatusCounts` (Fase 15/17) em vez de duplicar o `GROUP BY`
 * já usado pelos chips da fila.
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const [statusCounts, outcomeCounts, [avgDecisionRow], scoreRows] = await Promise.all([
    getApplicationStatusCounts(db),
    db
      .select({ outcome: creditDecisions.outcome, count: sql<number>`count(*)::int` })
      .from(creditDecisions)
      .groupBy(creditDecisions.outcome),
    db
      .select({
        avgHours: sql<
          number | null
        >`avg(extract(epoch from (${applications.decidedAt} - ${applications.createdAt})) / 3600)`,
      })
      .from(applications)
      .where(isNotNull(applications.decidedAt)),
    db.select({ scoreUsed: creditDecisions.scoreUsed }).from(creditDecisions),
  ])

  let totalDecisions = 0
  let approvedDecisions = 0
  const outcomeBreakdown = { approved: 0, denied: 0, manual_review: 0 }
  for (const row of outcomeCounts) {
    totalDecisions += row.count
    outcomeBreakdown[row.outcome] = row.count
    if (row.outcome === 'approved') approvedDecisions = row.count
  }
  const approvalRate = totalDecisions > 0 ? approvedDecisions / totalDecisions : null

  const scoreDistribution = SCORE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: scoreRows.filter((row) => row.scoreUsed >= bucket.min && row.scoreUsed < bucket.max)
      .length,
  }))

  sendJson(
    res,
    200,
    {
      statusCounts,
      totalDecisions,
      approvalRate,
      outcomeBreakdown,
      averageDecisionHours:
        avgDecisionRow?.avgHours != null ? Number(avgDecisionRow.avgHours) : null,
      scoreDistribution,
    },
    'no-store',
  )
}

export default handler
