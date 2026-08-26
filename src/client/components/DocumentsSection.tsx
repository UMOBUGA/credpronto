import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import type { DocumentSummary } from '@/shared/types'

const DOCUMENT_TYPES = [
  { value: 'rg', label: 'RG' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnh', label: 'CNH' },
  { value: 'comprovante_renda', label: 'Comprovante de renda' },
  { value: 'comprovante_residencia', label: 'Comprovante de residência' },
] as const

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
  const [type, setType] = useState<(typeof DOCUMENT_TYPES)[number]['value']>('rg')
  const fileInput = useRef<HTMLInputElement>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const file = fileInput.current?.files?.[0]
      if (!file) throw new Error('no_file')
      const contentBase64 = await readFileAsBase64(file)
      return apiFetch(`/api/client/${token}/documents`, {
        method: 'POST',
        body: JSON.stringify({ type, filename: file.name, mimeType: file.type, contentBase64 }),
      })
    },
    onSuccess: () => {
      if (fileInput.current) fileInput.current.value = ''
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
              {DOCUMENT_TYPES.find((t) => t.value === doc.type)?.label ?? doc.type} —{' '}
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
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arquivo
          <input ref={fileInput} type="file" accept="image/*,.pdf" required />
        </label>
        {mutation.isError && <p className="form-error">Não foi possível enviar o documento.</p>}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Enviando…' : 'Enviar documento'}
        </button>
      </form>
    </div>
  )
}
