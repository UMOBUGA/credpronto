import { eq } from 'drizzle-orm'
import retentionSweepHandler from './retention-sweep'
import { getDb } from '../_lib/db'
import {
  applicants,
  applications,
  auditLog,
  documentExtractions,
  documents,
  type ApplicationStatus,
} from '../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../_lib/testFixtures'
import { mockReq, mockRes } from '../_lib/testHttp'

const DAY_MS = 24 * 60 * 60 * 1000

async function seedApplicationWithStatus(
  db: Awaited<ReturnType<typeof getDb>>,
  dealerUserId: string,
  status: ApplicationStatus,
  updatedAt: Date,
  applicantId?: string,
) {
  const applicant = applicantId
    ? (await db.select().from(applicants).where(eq(applicants.id, applicantId)).limit(1))[0]!
    : await seedApplicant(db)
  const application = await seedApplication(db, { applicantId: applicant.id, dealerUserId })
  await db
    .update(applications)
    .set({ status, updatedAt })
    .where(eq(applications.id, application.id))
  return { applicant, applicationId: application.id }
}

describe('POST /api/cron/retention-sweep', () => {
  it('anonimiza applicant + apaga documentos/extrações de uma proposta denied vencida', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const { applicant, applicationId } = await seedApplicationWithStatus(
      db,
      dealer.id,
      'denied',
      new Date(Date.now() - 200 * DAY_MS),
    )

    const [doc] = await db
      .insert(documents)
      .values({
        applicationId,
        type: 'rg',
        storageKey: 'nao-existe.jpg',
        mimeType: 'image/jpeg',
        uploadedBy: 'applicant',
        status: 'extracted',
      })
      .returning()
    await db.insert(documentExtractions).values({
      documentId: doc!.id,
      extractedFieldsEncrypted: 'x',
      confidenceScore: 0.9,
      modelUsed: 'claude-opus-5',
      status: 'auto_accepted',
    })

    const res = mockRes()
    await retentionSweepHandler(mockReq('/api/cron/retention-sweep'), res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { anonymizedCount: number; anonymized: string[] }
    expect(body.anonymized).toContain(applicationId)

    const [updatedApplicant] = await db
      .select()
      .from(applicants)
      .where(eq(applicants.id, applicant.id))
      .limit(1)
    expect(updatedApplicant?.anonymizedAt).not.toBeNull()
    expect(updatedApplicant?.fullNameEncrypted).not.toBe(applicant.fullNameEncrypted)
    expect(updatedApplicant?.cpfHash).not.toBe(applicant.cpfHash)
    expect(updatedApplicant?.monthlyIncomeDeclaredEncrypted).toBeNull()

    const remainingDocs = await db
      .select()
      .from(documents)
      .where(eq(documents.applicationId, applicationId))
    expect(remainingDocs).toHaveLength(0)
    const remainingExtractions = await db
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, doc!.id))
    expect(remainingExtractions).toHaveLength(0)

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, applicant.id))
    expect(auditRows.some((row) => row.action === 'applicant.anonymized')).toBe(true)
  })

  it('dryRun=true reporta sem escrever nada', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const { applicant, applicationId } = await seedApplicationWithStatus(
      db,
      dealer.id,
      'cancelled',
      new Date(Date.now() - 200 * DAY_MS),
    )

    const res = mockRes()
    await retentionSweepHandler(mockReq('/api/cron/retention-sweep?dryRun=true'), res)

    expect((res.body as { dryRun: boolean; anonymized: string[] }).dryRun).toBe(true)
    expect((res.body as { anonymized: string[] }).anonymized).toContain(applicationId)

    const [unchanged] = await db
      .select()
      .from(applicants)
      .where(eq(applicants.id, applicant.id))
      .limit(1)
    expect(unchanged?.anonymizedAt).toBeNull()
    expect(unchanged?.fullNameEncrypted).toBe(applicant.fullNameEncrypted)
  })

  it('não reprocessa um applicant já anonimizado', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const { applicationId } = await seedApplicationWithStatus(
      db,
      dealer.id,
      'expired',
      new Date(Date.now() - 200 * DAY_MS),
    )
    await db
      .update(applicants)
      .set({ anonymizedAt: new Date() })
      .where(
        eq(
          applicants.id,
          (
            await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1)
          )[0]!.applicantId,
        ),
      )

    const res = mockRes()
    await retentionSweepHandler(mockReq('/api/cron/retention-sweep'), res)
    const body = res.body as { anonymized: string[]; skippedAlreadyDone: string[] }
    expect(body.anonymized).not.toContain(applicationId)
    expect(body.skippedAlreadyDone).toContain(applicationId)
  })

  it('não anonimiza enquanto o mesmo titular tiver outra proposta ativa', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const { applicant, applicationId: terminalId } = await seedApplicationWithStatus(
      db,
      dealer.id,
      'denied',
      new Date(Date.now() - 200 * DAY_MS),
    )
    // Segunda proposta do mesmo titular, ainda em andamento.
    await seedApplicationWithStatus(db, dealer.id, 'running_checks', new Date(), applicant.id)

    const res = mockRes()
    await retentionSweepHandler(mockReq('/api/cron/retention-sweep'), res)
    const body = res.body as { anonymized: string[]; skippedActiveSibling: string[] }
    expect(body.anonymized).not.toContain(terminalId)
    expect(body.skippedActiveSibling).toContain(terminalId)

    const [unchanged] = await db
      .select()
      .from(applicants)
      .where(eq(applicants.id, applicant.id))
      .limit(1)
    expect(unchanged?.anonymizedAt).toBeNull()
  })

  it('offer_accepted só entra na janela longa — recente não é tocado, antigo é anonimizado', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const recent = await seedApplicationWithStatus(
      db,
      dealer.id,
      'offer_accepted',
      new Date(Date.now() - 10 * DAY_MS),
    )
    const old = await seedApplicationWithStatus(
      db,
      dealer.id,
      'offer_accepted',
      new Date(Date.now() - 2000 * DAY_MS),
    )

    const res = mockRes()
    await retentionSweepHandler(mockReq('/api/cron/retention-sweep'), res)
    const body = res.body as { anonymized: string[] }
    expect(body.anonymized).not.toContain(recent.applicationId)
    expect(body.anonymized).toContain(old.applicationId)
  })

  it('exige CRON_SECRET quando configurado', async () => {
    const original = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'segredo-de-teste'
    try {
      const res = mockRes()
      await retentionSweepHandler(mockReq('/api/cron/retention-sweep'), res)
      expect(res.statusCode).toBe(401)
    } finally {
      process.env.CRON_SECRET = original
    }
  })
})
