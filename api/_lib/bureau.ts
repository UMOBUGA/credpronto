import { createHash } from 'node:crypto'

export interface BureauResult {
  score: number
  hasRestriction: boolean
  restrictionDetails: { reason: string }[] | null
}

/**
 * Bureau real (Serasa/SPC) exige CNPJ e contrato comercial pago — fora do
 * alcance de um projeto de portfólio (ver CLAUDE.md/README). Este mock é
 * determinístico por CPF: o mesmo CPF sempre produz o mesmo resultado, o que
 * torna demos e testes reproduzíveis sem precisar guardar estado. As duas
 * env vars são só para forçar um cenário específico manualmente em dev.
 */
export function checkBureauMock(cpf: string): BureauResult {
  const forced = process.env.MOCK_BUREAU_SCENARIO
  if (forced === 'restricted') {
    return {
      score: 320,
      hasRestriction: true,
      restrictionDetails: [{ reason: 'Dívida em atraso simulada' }],
    }
  }
  if (forced === 'clean') {
    return { score: 820, hasRestriction: false, restrictionDetails: null }
  }

  const digest = createHash('sha256').update(cpf).digest()
  const score = 300 + (digest.readUInt16BE(0) % 601)
  const hasRestriction = digest[2]! % 10 === 0

  return {
    score,
    hasRestriction,
    restrictionDetails: hasRestriction ? [{ reason: 'Restrição simulada de crédito' }] : null,
  }
}
