import { MockOpenFinanceClient, RealOpenFinanceClient, getOpenFinanceClient } from './openfinance'

describe('MockOpenFinanceClient', () => {
  const originalScenario = process.env.MOCK_OPENFINANCE_SCENARIO

  afterEach(() => {
    process.env.MOCK_OPENFINANCE_SCENARIO = originalScenario
  })

  it('gera um consentimento e tokens simulados', async () => {
    const client = new MockOpenFinanceClient()
    const { providerConsentId } = await client.initiateConsent('39053344705')
    expect(providerConsentId).toMatch(/^mock-consent-/)

    const tokens = await client.authorize(providerConsentId)
    expect(tokens.accessToken).toContain(providerConsentId)
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('estima renda de forma determinística pelo CPF', async () => {
    delete process.env.MOCK_OPENFINANCE_SCENARIO
    const client = new MockOpenFinanceClient()
    const a = await client.fetchAccountData('token', '39053344705')
    const b = await client.fetchAccountData('token', '39053344705')
    expect(a.monthlyIncomeEstimate).toBe(b.monthlyIncomeEstimate)
  })

  it('respeita o cenário forçado "income_mismatch"', async () => {
    process.env.MOCK_OPENFINANCE_SCENARIO = 'income_mismatch'
    const client = new MockOpenFinanceClient()
    const data = await client.fetchAccountData('token', '39053344705')
    expect(data.monthlyIncomeEstimate).toBe(1000)
  })

  it('respeita o cenário forçado "clean"', async () => {
    process.env.MOCK_OPENFINANCE_SCENARIO = 'clean'
    const client = new MockOpenFinanceClient()
    const data = await client.fetchAccountData('token', '39053344705')
    expect(data.monthlyIncomeEstimate).toBe(20000)
  })
})

describe('RealOpenFinanceClient', () => {
  it('lança em todos os métodos — nunca finge funcionar sem credencial institucional', async () => {
    const client = new RealOpenFinanceClient()
    await expect(client.initiateConsent()).rejects.toThrow(/Banco Central/)
    await expect(client.authorize()).rejects.toThrow()
    await expect(client.fetchAccountData()).rejects.toThrow()
  })
})

describe('getOpenFinanceClient', () => {
  const originalEnabled = process.env.OPENFINANCE_ENABLED

  afterEach(() => {
    process.env.OPENFINANCE_ENABLED = originalEnabled
  })

  it('usa o mock por padrão', () => {
    delete process.env.OPENFINANCE_ENABLED
    expect(getOpenFinanceClient()).toBeInstanceOf(MockOpenFinanceClient)
  })

  it('usa o client real só quando OPENFINANCE_ENABLED=true', () => {
    process.env.OPENFINANCE_ENABLED = 'true'
    expect(getOpenFinanceClient()).toBeInstanceOf(RealOpenFinanceClient)
  })
})
