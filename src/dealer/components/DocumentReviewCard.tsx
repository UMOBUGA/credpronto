import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { DOCUMENT_TYPE_LABELS } from '@/shared/documentTypes'
import type { DocumentSummary } from '@/shared/types'

const EXTRACTION_STATUS_LABELS: Record<
  NonNullable<DocumentSummary['extraction']>['status'],
  string
> = {
  auto_accepted: 'Aceito automaticamente',
  needs_review: 'Precisa de revisão',
  reviewed: 'Revisado pelo dealer',
  rejected: 'Rejeitado',
}

interface Props {
  applicationId: string
  document: DocumentSummary
  onChanged: () => void
}

export function DocumentReviewCard({ applicationId, document, onChanged }: Props) {
  const queryClient = useQueryClient()
  const [editedFields, setEditedFields] = useState<Record<string, string> | null>(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['application', applicationId] })
    onChanged()
  }

  const retry = useMutation({
    mutationFn: () =>
      apiFetch<{ documentStatus: string }>(`/api/documents/${document.id}/extract`, {
        method: 'POST',
      }),
    onSuccess: invalidate,
  })

  const review = useMutation({
    mutationFn: (
      body:
        { action: 'approve' | 'reject' } | { action: 'correct'; fields: Record<string, string> },
    ) =>
      apiFetch(`/api/documents/${document.id}/extract`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditedFields(null)
      invalidate()
    },
  })

  const extraction = document.extraction
  const isImage = document.mimeType?.startsWith('image/')

  return (
    <div className="document-review-card">
      <div className="document-review-header">
        <strong>{DOCUMENT_TYPE_LABELS[document.type]}</strong>
        <span>{document.status}</span>
      </div>

      {document.status === 'failed' && (
        <>
          <button onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? 'Tentando…' : 'Tentar extrair de novo'}
          </button>
          {(retry.isError || retry.data?.documentStatus === 'failed') && (
            <p className="form-error">
              A extração falhou de novo — confira se a chave da Anthropic está configurada no
              servidor.
            </p>
          )}
        </>
      )}

      {document.status === 'extracted' && (
        <a href={`/api/documents/${document.id}/file`} target="_blank" rel="noreferrer">
          {isImage ? 'Ver imagem do documento' : 'Abrir arquivo'}
        </a>
      )}

      {document.manualFields && Object.keys(document.manualFields).length > 0 && (
        <div className="document-manual-fields">
          <p className="hint-text">Dados informados pelo cliente no envio:</p>
          <dl>
            {Object.entries(document.manualFields).map(([key, value]) => (
              <div key={key} className="document-field-row">
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {extraction && (
        <div className="document-extraction">
          <p>
            {EXTRACTION_STATUS_LABELS[extraction.status]} — confiança{' '}
            {Math.round(extraction.confidenceScore * 100)}%
          </p>

          {extraction.status === 'needs_review' ? (
            <>
              <dl>
                {Object.entries(editedFields ?? extraction.fields).map(([key, value]) => (
                  <div key={key} className="document-field-row">
                    <dt>{key}</dt>
                    <dd>
                      <input
                        value={value}
                        onChange={(e) =>
                          setEditedFields({
                            ...(editedFields ?? extraction.fields),
                            [key]: e.target.value,
                          })
                        }
                      />
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="actions">
                <button
                  onClick={() =>
                    editedFields
                      ? review.mutate({ action: 'correct', fields: editedFields })
                      : review.mutate({ action: 'approve' })
                  }
                  disabled={review.isPending}
                >
                  {editedFields ? 'Salvar correção' : 'Aprovar'}
                </button>
                <button
                  className="button-secondary"
                  onClick={() => review.mutate({ action: 'reject' })}
                  disabled={review.isPending}
                >
                  Rejeitar
                </button>
              </div>
              {review.isError && (
                <p className="form-error">Não foi possível salvar. Tente novamente.</p>
              )}
            </>
          ) : (
            <dl>
              {Object.entries(extraction.fields).map(([key, value]) => (
                <div key={key} className="document-field-row">
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  )
}
