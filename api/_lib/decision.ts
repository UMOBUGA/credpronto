export type DecisionOutcome = 'approved' | 'denied' | 'manual_review'

export interface DecisionInput {
  bureauScore: number
  hasBureauRestriction: boolean
  requestedAmount: number
  monthlyIncomeDeclared: number
  requestedTermMonths: number
}

export interface DecisionResult {
  outcome: DecisionOutcome
  scoreUsed: number
  factors: DecisionInput & { debtToIncome: number }
}

const APPROVE_MIN_SCORE = 700
const APPROVE_MAX_DEBT_TO_INCOME = 0.3
const DENY_MAX_SCORE = 450
const DENY_MIN_DEBT_TO_INCOME = 0.5

/**
 * Motor determinístico — nunca chama IA e nunca é chamado por ela. O parecer
 * em linguagem natural (Fase 3, `claude.ts::generateNarrative`) explica ESTA
 * decisão depois de tomada, nunca a substitui: essa é a fronteira de
 * responsabilidade/auditabilidade do projeto. Pesos e limites são regra fixa
 * nesta v1 — "aprender" a partir de dado histórico fica fora de escopo.
 */
export function decide(input: DecisionInput): DecisionResult {
  const {
    bureauScore,
    hasBureauRestriction,
    requestedAmount,
    monthlyIncomeDeclared,
    requestedTermMonths,
  } = input

  const monthlyInstallment = requestedAmount / requestedTermMonths
  const debtToIncome =
    monthlyIncomeDeclared > 0
      ? monthlyInstallment / monthlyIncomeDeclared
      : Number.POSITIVE_INFINITY
  const factors = { ...input, debtToIncome }

  if (hasBureauRestriction) {
    return { outcome: 'denied', scoreUsed: bureauScore, factors }
  }
  if (bureauScore >= APPROVE_MIN_SCORE && debtToIncome <= APPROVE_MAX_DEBT_TO_INCOME) {
    return { outcome: 'approved', scoreUsed: bureauScore, factors }
  }
  if (bureauScore < DENY_MAX_SCORE || debtToIncome > DENY_MIN_DEBT_TO_INCOME) {
    return { outcome: 'denied', scoreUsed: bureauScore, factors }
  }
  return { outcome: 'manual_review', scoreUsed: bureauScore, factors }
}
