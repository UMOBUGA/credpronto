import { randomUUID } from 'node:crypto'
import auditLogHandler from './audit-log'
import applicationDetailHandler from '../[id]'
import { getDb } from '../../_lib/db'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

describe('GET /api/applications/[id]/audit-log', () => {
  it('devolve os eventos da proposta em ordem cronológica reversa', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    // Ver o detalhe da proposta decripta campos e grava `pii.decrypted` —
    // gera eventos reais na trilha sem precisar inserir linhas à mão.
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, { headers: { cookie } }),
      mockRes(),
    )

    const res = mockRes()
    await auditLogHandler(
      mockReq(`/api/applications/${application.id}/audit-log`, { headers: { cookie } }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    const entries = res.body as { action: string; occurredAt: string }[]
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.action === 'pii.decrypted')).toBe(true)
    const timestamps = entries.map((e) => new Date(e.occurredAt).getTime())
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps)
  })

  it('sem sessão recebe 401', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    const res = mockRes()
    await auditLogHandler(mockReq(`/api/applications/${application.id}/audit-log`), res)
    expect(res.statusCode).toBe(401)
  })

  it('proposta inexistente recebe 404', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await auditLogHandler(
      mockReq(`/api/applications/${randomUUID()}/audit-log`, { headers: { cookie } }),
      res,
    )
    expect(res.statusCode).toBe(404)
  })
})
