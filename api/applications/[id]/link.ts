import { eq } from 'drizzle-orm'
import { getDb } from '../../_lib/db'
import { applications } from '../../_lib/schema'
import { generateClientPortalToken, requireDealerSession } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { logAction } from '../../_lib/audit'
import { pathSegment, sendJson, type Handler } from '../../_lib/http'

const LINK_TTL_DAYS = 7

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const applicationId = pathSegment(req, 1)
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)
  if (!application) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const token = generateClientPortalToken()
  await db
    .update(applications)
    .set({
      clientPortalToken: token,
      clientPortalTokenExpiresAt: new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId))

  if (application.status === 'draft') {
    await transition(db, applicationId, 'link_sent', { actorType: 'dealer_user', actorId: user.id })
  } else {
    await logAction(
      db,
      { actorType: 'dealer_user', actorId: user.id },
      {
        action: 'application.link_regenerated',
        entityType: 'application',
        entityId: applicationId,
        applicationId,
      },
    )
  }

  sendJson(res, 200, { portalPath: `/portal/${token}` })
}

export default handler
