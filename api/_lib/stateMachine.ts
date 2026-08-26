import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { applications, type ApplicationStatus } from './schema'
import type { AuditActor } from './audit'
import { logAction } from './audit'

/**
 * Grafo de transição único e centralizado — todo handler que muda o status
 * de uma proposta passa por `transition()`, nunca por um `UPDATE` direto.
 * Isso garante duas coisas de uma vez: nenhum código produz um status
 * inalcançável a partir de onde a proposta estava, e toda mudança de estado
 * vira uma linha auditável, por construção.
 */
const GRAPH: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['link_sent', 'cancelled'],
  link_sent: ['client_submitted', 'expired', 'cancelled'],
  client_submitted: ['processing_documents', 'cancelled'],
  processing_documents: ['documents_review_required', 'documents_verified'],
  documents_review_required: ['documents_verified', 'cancelled'],
  documents_verified: ['awaiting_openfinance_consent'],
  awaiting_openfinance_consent: ['openfinance_authorized', 'openfinance_failed', 'cancelled'],
  openfinance_authorized: ['running_checks'],
  openfinance_failed: ['running_checks', 'cancelled'],
  running_checks: ['manual_review', 'approved', 'denied'],
  manual_review: ['approved', 'denied'],
  approved: ['offer_created'],
  denied: [],
  offer_created: ['offer_sent'],
  offer_sent: ['offer_accepted', 'offer_declined'],
  offer_accepted: [],
  offer_declined: [],
  expired: [],
  cancelled: [],
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return GRAPH[from].includes(to)
}

/** Estados terminais elegíveis para a varredura de retenção da Fase 5. */
export const RETENTION_ELIGIBLE_STATUSES: ApplicationStatus[] = [
  'denied',
  'expired',
  'cancelled',
  'offer_declined',
]

export class InvalidTransitionError extends Error {
  constructor(from: ApplicationStatus, to: ApplicationStatus) {
    super(`Transição inválida: ${from} -> ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export async function transition(
  db: Db,
  applicationId: string,
  to: ApplicationStatus,
  actor: AuditActor,
): Promise<void> {
  const [application] = await db
    .select({ status: applications.status })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)

  if (!application) {
    throw new Error(`Proposta não encontrada: ${applicationId}`)
  }

  const from = application.status
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }

  const isDecision = to === 'approved' || to === 'denied'
  await db
    .update(applications)
    .set({
      status: to,
      updatedAt: new Date(),
      ...(isDecision ? { decidedAt: new Date(), decidedBy: actor.actorId ?? null } : {}),
    })
    .where(eq(applications.id, applicationId))

  await logAction(db, actor, {
    action: 'application.status_changed',
    entityType: 'application',
    entityId: applicationId,
    applicationId,
    metadata: { from, to },
  })
}
