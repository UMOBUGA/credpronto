import { createHash } from 'node:crypto'

export interface AntifraudInput {
  declaredCpf: string
  declaredFullName: string
  extractedCpf: string | null
  extractedFullName: string | null
  birthDate: string | null
}

export interface AntifraudResult {
  riskScore: number
  flags: string[]
  provider: string
}

const MINIMUM_AGE = 18
const RISK_PER_FLAG = 30

function normalizeName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function calculateAge(birthDateIso: string): number {
  const birth = new Date(birthDateIso)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hadBirthdayThisYear) age -= 1
  return age
}

/**
 * Mock determinístico por CPF, mesmo espírito do bureau (`bureau.ts`) —
 * provider real desse tipo de dado (Serpro Datavalid, CAF, Unico,
 * ClearSale) exigiria contrato comercial, mesma limitação do Serasa.
 */
function checkKnownFraudDatabaseMock(cpf: string): boolean {
  const forced = process.env.MOCK_ANTIFRAUD_SCENARIO
  if (forced === 'flagged') return true
  if (forced === 'clean') return false

  const digest = createHash('sha256').update(cpf).digest()
  return digest[1]! % 25 === 0
}

/**
 * A metade real cruza o que foi declarado (na criação da proposta, ou pelo
 * cliente) com o que a IA extraiu do documento na Fase 2 — nunca confia num
 * único lado; essa comparação é engenharia de verdade, as duas fontes de
 * dado já existiam no sistema, só nunca tinham sido cruzadas. A metade mock
 * representa uma consulta a uma base de fraudadores conhecidos.
 */
export function checkAntifraud(input: AntifraudInput): AntifraudResult {
  const flags: string[] = []

  if (input.extractedCpf && input.extractedCpf !== input.declaredCpf) {
    flags.push('cpf_mismatch')
  }
  if (
    input.extractedFullName &&
    normalizeName(input.extractedFullName) !== normalizeName(input.declaredFullName)
  ) {
    flags.push('name_mismatch')
  }
  if (input.birthDate && calculateAge(input.birthDate) < MINIMUM_AGE) {
    flags.push('underage')
  }
  if (checkKnownFraudDatabaseMock(input.declaredCpf)) {
    flags.push('known_fraud_list')
  }

  return {
    riskScore: Math.min(100, flags.length * RISK_PER_FLAG),
    flags,
    provider: 'cross-validation+mock-fraud-db',
  }
}
