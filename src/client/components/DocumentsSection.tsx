import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { DOCUMENT_TYPES } from '@/shared/documentTypes'
import type { DocumentSummary, DocumentType } from '@/shared/types'

interface Props {
  token: string
  documents: DocumentSummary[]
  onUploaded: () => void
}

const STATUS_LABELS: Record<DocumentSummary['status'], string> = {
  uploaded: 'enviado',
  extracting: 'analisando…',
  extracted: 'recebido',
  failed: 'falhou — tente reenviar',
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error as Error)
    reader.readAsDataURL(file)
  })
}

export function DocumentsSection({ token, documents, onUploaded }: Props) {
  const [type, setType] = useState<DocumentType>('rg')
  const [manualFields, setManualFields] = useState<Record<string, string>>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const selectedSpec = DOCUMENT_TYPES.find((spec) => spec.value === type)!

  // Sempre revoga a URL do preview anterior ao trocar de arquivo ou ao
  // desmontar — é um object URL, fica vivo até ser liberado explicitamente.
  useEffect(() => () => (previewUrl ? URL.revokeObjectURL(previewUrl) : undefined), [previewUrl])

  function handleTypeChange(nextType: DocumentType) {
    setType(nextType)
    setManualFields({})
  }

  function handleFileChange() {
    const file = fileInput.current?.files?.[0]
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    })
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const file = fileInput.current?.files?.[0]
      if (!file) throw new Error('no_file')
      const contentBase64 = await readFileAsBase64(file)
      return apiFetch(`/api/client/${token}/documents`, {
        method: 'POST',
        body: JSON.stringify({
          type,
          filename: file.name,
          mimeType: file.type,
          contentBase64,
          manualFields: Object.keys(manualFields).length > 0 ? manualFields : undefined,
        }),
      })
    },
    onSuccess: () => {
      if (fileInput.current) fileInput.current.value = ''
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return null
      })
      setManualFields({})
      onUploaded()
    },
  })

  return (
    <div className="client-card">
      <h2>Documentos</h2>
      {documents.length > 0 && (
        <ul>
          {documents.map((doc) => (
            <li key={doc.id}>
              {DOCUMENT_TYPES.find((spec) => spec.value === doc.type)?.label ?? doc.type} —{' '}
              {STATUS_LABELS[doc.status]}
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <label>
          Tipo de documento
          <select value={type} onChange={(e) => handleTypeChange(e.target.value as DocumentType)}>
            {DOCUMENT_TYPES.map((spec) => (
              <option key={spec.value} value={spec.value}>
                {spec.label}
              </option>
            ))}
          </select>
        </label>

        {selectedSpec.manualFields.length > 0 && (
          <fieldset>
            <legend>Dados do documento</legend>
            {selectedSpec.manualFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  value={manualFields[field.key] ?? ''}
                  onChange={(e) =>
                    setManualFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  required={field.required}
                />
              </label>
            ))}
          </fieldset>
        )}

        <label>
          Arquivo (foto ou PDF)
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.pdf"
            required
            onChange={handleFileChange}
          />
        </label>
        {previewUrl && (
          <img src={previewUrl} alt="Pré-visualização do documento" className="document-preview" />
        )}

        {mutation.isError && <p className="form-error">Não foi possível enviar o documento.</p>}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Enviando…' : 'Enviar documento'}
        </button>
      </form>
    </div>
  )
}
