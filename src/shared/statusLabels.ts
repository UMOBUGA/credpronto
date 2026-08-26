import type { ApplicationStatus } from './types'

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Rascunho',
  link_sent: 'Link enviado',
  client_submitted: 'Dados recebidos',
  processing_documents: 'Processando documentos',
  documents_review_required: 'Documentos em revisão',
  documents_verified: 'Documentos verificados',
  awaiting_openfinance_consent: 'Aguardando Open Finance',
  openfinance_authorized: 'Open Finance autorizado',
  openfinance_failed: 'Open Finance indisponível',
  running_checks: 'Analisando crédito',
  manual_review: 'Revisão manual',
  approved: 'Aprovada',
  denied: 'Negada',
  offer_created: 'Oferta gerada',
  offer_sent: 'Oferta enviada',
  offer_accepted: 'Oferta aceita',
  offer_declined: 'Oferta recusada',
  expired: 'Link expirado',
  cancelled: 'Cancelada',
}
