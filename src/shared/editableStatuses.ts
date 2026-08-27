import type { ApplicationStatus } from './types'

/**
 * Mesma lista de `EDITABLE_STATUSES` em `api/applications/[id].ts`, duplicada
 * aqui porque o frontend não pode importar de `api/_lib`/`api/` (bundles
 * separados, ver CLAUDE.md). Controla só se a UI mostra o formulário de
 * edição — o backend continua sendo a única fonte de verdade (o PATCH
 * recusa com 409 fora desses status independente do que o frontend mostrar).
 */
export const EDITABLE_STATUSES = new Set<ApplicationStatus>([
  'draft',
  'link_sent',
  'client_submitted',
])
