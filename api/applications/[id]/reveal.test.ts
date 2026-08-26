import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import revealHandler from './reveal'
import { getDb } from '../../_lib/db'
import { applicants, auditLog } from '../../_lib/schema'
import { encryptField } from '../../_lib/crypto'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

describe('POST /api/applications/[id]/reveal', () => {
  it('admin consegue revelar CPF e a chamada grava pii.revealed em audit_log', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db, 'admin')
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await revealHandler(
      mockReq(`/api/applications/${application.id}/reveal`, {
        method: 'POST',
        headers: { cookie },
        body: { field: 'cpf' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    const body = res.body as { field: string; value: string }
    expect(body.field).toBe('cpf')
    expect(body.value).toMatch(/^\d{11}$/)
    expect(res.headers['Cache-Control']).toBe('no-store')

    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, applicant.id))
    expect(entries.some((entry) => entry.action === 'pii.revealed')).toBe(true)
  })

  it('devolve value: null quando o applicant não tem renda declarada', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db, 'manager')
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await revealHandler(
      mockReq(`/api/applications/${application.id}/reveal`, {
        method: 'POST',
        headers: { cookie },
        body: { field: 'monthlyIncomeDeclared' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { value: number | null }).value).toBeNull()
  })

  it('revela a renda declarada quando presente', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db, 'admin')
    const applicant = await seedApplicant(db)
    await db
      .update(applicants)
      .set({ monthlyIncomeDeclaredEncrypted: encryptField('8500') })
      .where(eq(applicants.id, applicant.id))
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await revealHandler(
      mockReq(`/api/applications/${application.id}/reveal`, {
        method: 'POST',
        headers: { cookie },
        body: { field: 'monthlyIncomeDeclared' },
      }),
      res,
    )

    expect((res.body as { value: number }).value).toBe(8500)
  })

  it('analyst recebe 403 — revelação é restrita a admin/manager', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db, 'analyst')
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await revealHandler(
      mockReq(`/api/applications/${application.id}/reveal`, {
        method: 'POST',
        headers: { cookie },
        body: { field: 'cpf' },
      }),
      res,
    )

    expect(res.statusCode).toBe(403)
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
    await revealHandler(
      mockReq(`/api/applications/${application.id}/reveal`, {
        method: 'POST',
        body: { field: 'cpf' },
      }),
      res,
    )

    expect(res.statusCode).toBe(401)
  })

  it('proposta inexistente recebe 404', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db, 'admin')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await revealHandler(
      mockReq(`/api/applications/${randomUUID()}/reveal`, {
        method: 'POST',
        headers: { cookie },
        body: { field: 'cpf' },
      }),
      res,
    )

    expect(res.statusCode).toBe(404)
  })
})
