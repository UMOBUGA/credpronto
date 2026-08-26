import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import type { AuditLogEntry } from '@/shared/types'

interface Props {
  applicationId: string
}

const ACTOR_LABELS: Record<AuditLogEntry['actorType'], string> = {
  dealer_user: 'Loja',
  applicant: 'Cliente',
  system: 'Sistema',
  cron: 'Job agendado',
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })

/**
 * Trilha de auditoria da proposta — toda decriptação de PII e toda mudança
 * de estado passam por aqui por construção (ver `audit.ts`/`crypto.ts`/
 * `stateMachine.ts`), então esta lista é a prova visível de que a auditoria
 * não é só um requisito de LGPD escrito em texto.
 */
export function AuditLogPanel({ applicationId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['application', applicationId, 'audit-log'],
    queryFn: () => apiFetch<AuditLogEntry[]>(`/api/applications/${applicationId}/audit-log`),
  })

  return (
    <section className="detail-section">
      <h2>Trilha de auditoria</h2>
      {isLoading && <p className="hint-text">Carregando…</p>}
      {!isLoading && (!data || data.length === 0) && (
        <p className="hint-text">Nenhum evento registrado ainda.</p>
      )}
      {data && data.length > 0 && (
        <ul className="audit-log-list">
          {data.map((entry) => (
            <li key={entry.id} className="audit-log-entry">
              <span className="audit-log-time">
                {timeFormatter.format(new Date(entry.occurredAt))}
              </span>
              <span>
                [{ACTOR_LABELS[entry.actorType]}] {entry.action} — {entry.entityType}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
