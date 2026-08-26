import { createHash, randomUUID } from 'node:crypto'

export interface OpenFinanceAccount {
  id: string
  type: string
  balanceCents: number
}

export interface OpenFinanceTransaction {
  date: string
  description: string
  amountCents: number
}

export interface OpenFinanceAccountData {
  accounts: OpenFinanceAccount[]
  transactions: OpenFinanceTransaction[]
  monthlyIncomeEstimate: number
}

export interface OpenFinanceTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

export interface OpenFinanceClient {
  initiateConsent(cpf: string): Promise<{ providerConsentId: string }>
  authorize(providerConsentId: string): Promise<OpenFinanceTokens>
  fetchAccountData(accessToken: string, cpf: string): Promise<OpenFinanceAccountData>
}

/**
 * Simula o fluxo inteiro sem sair do app — não existe um "banco de
 * sandbox" real pra redirecionar o cliente, porque participar do Open
 * Finance Brasil (mesmo em sandbox) exige a instituição ser autorizada
 * pelo Banco Central, barreira regulatória que este projeto de portfólio
 * não tem como transpor (ver CLAUDE.md). Determinístico por CPF, mesmo
 * padrão de `bureau.ts`/`vehicleRestriction.ts`.
 */
export class MockOpenFinanceClient implements OpenFinanceClient {
  async initiateConsent(_cpf: string): Promise<{ providerConsentId: string }> {
    return { providerConsentId: `mock-consent-${randomUUID()}` }
  }

  async authorize(providerConsentId: string): Promise<OpenFinanceTokens> {
    return {
      accessToken: `mock-access-${providerConsentId}`,
      refreshToken: `mock-refresh-${providerConsentId}`,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    }
  }

  async fetchAccountData(_accessToken: string, cpf: string): Promise<OpenFinanceAccountData> {
    const forced = process.env.MOCK_OPENFINANCE_SCENARIO
    const digest = createHash('sha256').update(cpf).digest()
    const baseIncome = 3000 + (digest.readUInt16BE(0) % 12000)
    const monthlyIncomeEstimate =
      forced === 'clean' ? 20000 : forced === 'income_mismatch' ? 1000 : baseIncome

    return {
      accounts: [
        {
          id: `acc-${digest.toString('hex').slice(0, 8)}`,
          type: 'CONTA_DEPOSITO_A_VISTA',
          balanceCents: Math.round(monthlyIncomeEstimate * 100 * 2.5),
        },
      ],
      transactions: [
        {
          date: new Date().toISOString().slice(0, 10),
          description: 'Crédito simulado (folha de pagamento)',
          amountCents: Math.round(monthlyIncomeEstimate * 100),
        },
      ],
      monthlyIncomeEstimate,
    }
  }
}

/**
 * Interface real, nunca exercitada de verdade. Participar do Open Finance
 * Brasil — mesmo em sandbox — exige a instituição ser autorizada pelo
 * Banco Central (achado da pesquisa feita antes da Fase 5, ver CLAUDE.md).
 * Escrever um cliente OAuth2/FAPI/mTLS completo sem nunca poder testá-lo
 * contra um servidor real seria pior que não escrever — pareceria
 * funcional sem nunca ter sido validado. Esta classe existe só pra
 * documentar o formato de uma integração real (interface, tipos), cada
 * método lança um erro explícito em vez de fingir.
 */
export class RealOpenFinanceClient implements OpenFinanceClient {
  private unavailable(): never {
    throw new Error(
      'RealOpenFinanceClient não está implementado — participar do Open Finance Brasil exige ' +
        'a instituição ser autorizada pelo Banco Central, inacessível para este projeto de ' +
        'portfólio (ver CLAUDE.md). Defina OPENFINANCE_ENABLED=false (ou omita) para usar o mock.',
    )
  }

  // `async` de propósito, não só `(): Promise<T>` — sem isso, `unavailable()`
  // lançaria de forma síncrona na hora da chamada em vez de devolver uma
  // Promise rejeitada, quebrando o contrato da interface pra quem chamar
  // com `.catch()` direto em vez de `try`/`await`.
  async initiateConsent(): Promise<{ providerConsentId: string }> {
    this.unavailable()
  }

  async authorize(): Promise<OpenFinanceTokens> {
    this.unavailable()
  }

  async fetchAccountData(): Promise<OpenFinanceAccountData> {
    this.unavailable()
  }
}

export function getOpenFinanceClient(): OpenFinanceClient {
  return process.env.OPENFINANCE_ENABLED === 'true'
    ? new RealOpenFinanceClient()
    : new MockOpenFinanceClient()
}
