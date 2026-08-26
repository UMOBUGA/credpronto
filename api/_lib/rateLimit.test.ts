import { enforceRateLimit, getClientIp } from './rateLimit'
import { mockReq, mockRes } from './testHttp'

describe('enforceRateLimit', () => {
  it('libera requisições dentro do limite e bloqueia a partir do limite, com Retry-After', () => {
    const routeKey = `test.route.${Math.random()}`
    const req = mockReq('/api/whatever')

    for (let i = 0; i < 3; i++) {
      const res = mockRes()
      expect(enforceRateLimit(req, res, routeKey, 3, 60_000)).toBe(true)
      expect(res.statusCode).toBe(200)
    }

    const blockedRes = mockRes()
    expect(enforceRateLimit(req, blockedRes, routeKey, 3, 60_000)).toBe(false)
    expect(blockedRes.statusCode).toBe(429)
    expect(blockedRes.headers['Retry-After']).toBeDefined()
    expect((blockedRes.body as { error: string }).error).toBe('rate_limited')
  })

  it('mantém buckets isolados por routeKey — um endpoint saturado não bloqueia outro', () => {
    const req = mockReq('/api/whatever')
    const routeA = `test.route.a.${Math.random()}`
    const routeB = `test.route.b.${Math.random()}`

    expect(enforceRateLimit(req, mockRes(), routeA, 1, 60_000)).toBe(true)
    expect(enforceRateLimit(req, mockRes(), routeA, 1, 60_000)).toBe(false)
    expect(enforceRateLimit(req, mockRes(), routeB, 1, 60_000)).toBe(true)
  })

  it('mantém buckets isolados por IP dentro do mesmo routeKey', () => {
    const routeKey = `test.route.ip.${Math.random()}`
    const reqA = mockReq('/api/whatever', { headers: { 'x-forwarded-for': '1.1.1.1' } })
    const reqB = mockReq('/api/whatever', { headers: { 'x-forwarded-for': '2.2.2.2' } })

    expect(enforceRateLimit(reqA, mockRes(), routeKey, 1, 60_000)).toBe(true)
    expect(enforceRateLimit(reqA, mockRes(), routeKey, 1, 60_000)).toBe(false)
    expect(enforceRateLimit(reqB, mockRes(), routeKey, 1, 60_000)).toBe(true)
  })
})

describe('getClientIp', () => {
  it('usa o primeiro IP de x-forwarded-for quando presente', () => {
    const req = mockReq('/api/whatever', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('203.0.113.5')
  })

  it('devolve unknown quando não há x-forwarded-for nem socket (mockReq de teste)', () => {
    expect(getClientIp(mockReq('/api/whatever'))).toBe('unknown')
  })
})
