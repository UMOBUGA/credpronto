import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { notificationLog } from './schema'
import { seedApplicant, seedApplication, seedDealerUser } from './testFixtures'
import {
  MockNotificationClient,
  RealNotificationClient,
  getNotificationClient,
  notify,
} from './notifications'

describe('MockNotificationClient', () => {
  it('grava uma linha "sent" em notification_log, sem nenhum dado de PII', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    const client = new MockNotificationClient()
    await client.send(db, application.id, 'link_sent')

    const rows = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.applicationId, application.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      applicationId: application.id,
      channel: 'email',
      template: 'link_sent',
      status: 'sent',
    })
  })
})

describe('RealNotificationClient', () => {
  it('lança — nenhum provedor de e-mail configurado neste projeto de portfólio', async () => {
    const client = new RealNotificationClient()
    await expect(client.send()).rejects.toThrow(/provedor de e-mail/)
  })
})

describe('getNotificationClient', () => {
  const originalEnabled = process.env.NOTIFICATIONS_ENABLED

  afterEach(() => {
    process.env.NOTIFICATIONS_ENABLED = originalEnabled
  })

  it('usa o mock por padrão', () => {
    delete process.env.NOTIFICATIONS_ENABLED
    expect(getNotificationClient()).toBeInstanceOf(MockNotificationClient)
  })

  it('usa o client real só quando NOTIFICATIONS_ENABLED=true', () => {
    process.env.NOTIFICATIONS_ENABLED = 'true'
    expect(getNotificationClient()).toBeInstanceOf(RealNotificationClient)
  })
})

describe('notify — não-bloqueante', () => {
  const originalEnabled = process.env.NOTIFICATIONS_ENABLED

  afterEach(() => {
    process.env.NOTIFICATIONS_ENABLED = originalEnabled
  })

  it('com o mock, grava "sent" e não lança', async () => {
    delete process.env.NOTIFICATIONS_ENABLED
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    await expect(notify(db, application.id, 'offer_created')).resolves.toBeUndefined()

    const [row] = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.applicationId, application.id))
    expect(row?.status).toBe('sent')
    expect(row?.template).toBe('offer_created')
  })

  it('quando o client real lança, engole o erro e grava "failed" em vez de propagar', async () => {
    process.env.NOTIFICATIONS_ENABLED = 'true'
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    await expect(notify(db, application.id, 'decision_ready')).resolves.toBeUndefined()

    const [row] = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.applicationId, application.id))
    expect(row?.status).toBe('failed')
    expect(row?.template).toBe('decision_ready')
  })
})
