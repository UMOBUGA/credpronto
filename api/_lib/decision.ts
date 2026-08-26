export type DecisionOutcome = 'approved' | 'denied' | 'manual_review'

export interface DecisionInput {
  bureauScore: number
  hasBureauRestriction: boolean
  requestedAmount: number
  monthlyIncomeDeclared: number
  requestedTermMonths: number
  vehicleRestrictionFound: boolean
  fipeValue: number | null
  antifraudRiskScore: number
  antifraudFlags: string[]
  openfinanceVerified: boolean
  openfinanceIncomeEstimate: number | null
}

export interface DecisionResult {
  outcome: DecisionOutcome
  scoreUsed: number
  factors: DecisionInput & { debtToIncome: number; loanToValue: number | null }
}

const APPROVE_MIN_SCORE = 700
const APPROVE_MAX_DEBT_TO_INCOME = 0.3
const DENY_MAX_SCORE = 450
const DENY_MIN_DEBT_TO_INCOME = 0.5
/** Financiar mais de 110% do valor FIPE já é fator de risco por si só. */
const HIGH_LTV_THRESHOLD = 1.1
/** Nunca aprova sozinho um caso com um desses sinais — no mínimo revisão humana. */
const SEVERE_ANTIFRAUD_FLAGS = new Set(['cpf_mismatch', 'known_fraud_list'])
/**
 * Renda observada pelo Open Finance (simulado) abaixo de 50% da declarada
 * já é fator de risco — mas só quando o consentimento foi de fato
 * autorizado. Ausência de dado (consentimento negado, o que é legítimo e
 * comum) nunca penaliza.
 */
const INCOME_DIVERGENCE_THRESHOLD = 0.5

/**
 * Motor determinístico — nunca chama IA e nunca é chamado por ela. O parecer
 * em linguagem natural (Fase 4, `claude.ts::generateNarrative`) explica ESTA
 * decisão depois de tomada, nunca a substitui: essa é a fronteira de
 * responsabilidade/auditabilidade do projeto. Pesos e limites são regra fixa
 * nesta versão — "aprender" a partir de dado histórico fica fora de escopo.
 *
 * Ordem de checagem é deliberada: restrição de veículo (roubo/furto/gravame)
 * nega antes de qualquer outra coisa — não tem sentido financiar um carro
 * assim, seja qual for o perfil do comprador. Fraude grave vem em seguida e
 * força revisão humana, nunca aprovação automática. Só depois disso o resto
 * (bureau, renda, LTV, Open Finance) decide entre aprovar/negar/revisar.
 */
export function decide(input: DecisionInput): DecisionResult {
  const {
    bureauScore,
    hasBureauRestriction,
    requestedAmount,
    monthlyIncomeDeclared,
    requestedTermMonths,
    vehicleRestrictionFound,
    fipeValue,
    antifraudFlags,
    openfinanceVerified,
    openfinanceIncomeEstimate,
  } = input

  const monthlyInstallment = requestedAmount / requestedTermMonths
  const debtToIncome =
    monthlyIncomeDeclared > 0
      ? monthlyInstallment / monthlyIncomeDeclared
      : Number.POSITIVE_INFINITY
  const loanToValue = fipeValue && fipeValue > 0 ? requestedAmount / fipeValue : null
  const factors = { ...input, debtToIncome, loanToValue }

  if (vehicleRestrictionFound) {
    return { outcome: 'denied', scoreUsed: bureauScore, factors }
  }

  const hasSevereAntifraudFlag = antifraudFlags.some((flag) => SEVERE_ANTIFRAUD_FLAGS.has(flag))
  if (hasSevereAntifraudFlag) {
    return { outcome: 'manual_review', scoreUsed: bureauScore, factors }
  }

  if (hasBureauRestriction) {
    return { outcome: 'denied', scoreUsed: bureauScore, factors }
  }

  const highLoanToValue = loanToValue !== null && loanToValue > HIGH_LTV_THRESHOLD
  const hasIncomeDivergence =
    openfinanceVerified &&
    openfinanceIncomeEstimate !== null &&
    openfinanceIncomeEstimate < monthlyIncomeDeclared * INCOME_DIVERGENCE_THRESHOLD

  if (
    bureauScore >= APPROVE_MIN_SCORE &&
    debtToIncome <= APPROVE_MAX_DEBT_TO_INCOME &&
    !highLoanToValue &&
    !hasIncomeDivergence
  ) {
    return { outcome: 'approved', scoreUsed: bureauScore, factors }
  }
  if (bureauScore < DENY_MAX_SCORE || debtToIncome > DENY_MIN_DEBT_TO_INCOME) {
    return { outcome: 'denied', scoreUsed: bureauScore, factors }
  }
  return { outcome: 'manual_review', scoreUsed: bureauScore, factors }
}
