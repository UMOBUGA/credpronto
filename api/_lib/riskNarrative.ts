import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { creditDecisions } from './schema'
import { generateNarrative } from './claude'
import type { DecisionOutcome, DecisionResult } from './decision'

export interface GenerateNarrativeResult {
  generated: boolean
}

/**
 * Roda depois da decisão já ter sido tomada e persistida (`decide()` +
 * `INSERT` em `credit_decisions`) — nunca decide nada, só tenta explicar.
 * Não-bloqueante por design, mesmo espírito de `documentExtraction.ts`: se
 * a chamada falhar (rede, API fora do ar, saída malformada), a decisão em
 * si já está salva e segue válida — o dealer só vê os campos de parecer
 * vazios, com ação de retry disponível
 * (`POST /api/applications/[id]/narrative`).
 */
export async function generateAndSaveNarrative(
  db: Db,
  decisionId: string,
): Promise<GenerateNarrativeResult> {
  const [decision] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.id, decisionId))
    .limit(1)
  if (!decision) {
    throw new Error(`Decisão não encontrada: ${decisionId}`)
  }

  try {
    const narrative = await generateNarrative(
      decision.factorsJson as DecisionResult['factors'],
      decision.outcome as DecisionOutcome,
    )
    await db
      .update(creditDecisions)
      .set({
        riskNarrativeDealer: narrative.dealerNarrative,
        riskNarrativeApplicant: narrative.applicantNarrative,
      })
      .where(eq(creditDecisions.id, decisionId))
    return { generated: true }
  } catch {
    return { generated: false }
  }
}
