import type { Db } from './db'
import { auditLog } from './schema'

export type ActorType = 'dealer_user' | 'applicant' | 'system' | 'cron'

export interface AuditActor {
  actorType: ActorType
  actorId?: string
  ipAddress?: string
}

export interface AuditEvent {
  action: string
  entityType: string
  entityId: string
  applicationId?: string
  metadata?: Record<string, unknown>
}

/**
 * Único ponto de escrita em `audit_log`. `metadata` nunca deve carregar valor
 * de PII — só nome de campo/tipo de ação (ex.: `{ field: 'cpf' }`). Quem
 * decide isso é quem chama, mas `decryptField` (`crypto.ts`) é o único
 * caminho de leitura de campo sensível e sempre passa metadata nesse formato,
 * o que cobre o caso mais arriscado por construção.
 */
export async function logAction(db: Db, actor: AuditActor, event: AuditEvent): Promise<void> {
  await db.insert(auditLog).values({
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    ipAddress: actor.ipAddress ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    applicationId: event.applicationId ?? null,
    metadataJson: event.metadata ?? null,
  })
}
