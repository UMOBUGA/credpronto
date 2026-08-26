import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { consentRecords } from '../../_lib/schema'
import { requireApplicationByToken } from '../../_lib/auth'
import { enforceRateLimit } from '../../_lib/rateLimit'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const PRIVACY_POLICY_VERSION = '2026-08-26'

const bodySchema = z.object({
  consentType: z.enum([
    'data_processing',
    'bureau_check',
    'openfinance_share',
    'ai_narrative_share',
  ]),
  granted: z.boolean(),
})

const handler: Handler = async (req, res) => {
  if (!enforceRateLimit(req, res, 'client.consent', 30, 60 * 1000)) return

  const db = await getDb()
  const token = pathSegment(req, 1)
  const application = await requireApplicationByToken(res, db, token)
  if (!application) return

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  if (!parsed.data.granted) {
    await db
      .update(consentRecords)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(consentRecords.applicationId, application.id),
          eq(consentRecords.consentType, parsed.data.consentType),
          isNull(consentRecords.revokedAt),
        ),
      )
    sendJson(res, 200, { revoked: true })
    return
  }

  const [record] = await db
    .insert(consentRecords)
    .values({
      applicantId: application.applicantId,
      applicationId: application.id,
      consentType: parsed.data.consentType,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    })
    .returning()

  sendJson(res, 201, record)
}

export default handler
