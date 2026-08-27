import type { DocumentType } from './types'

export interface ManualFieldSpec {
  key: string
  label: string
  required: boolean
}

export interface DocumentTypeSpec {
  value: DocumentType
  label: string
  /** Campos digitados junto com a foto no envio — vazio quando o tipo não precisa de nenhum. */
  manualFields: ManualFieldSpec[]
}

/**
 * Fonte única de tipo de documento + campo manual esperado — usada pelo
 * upload do portal do cliente (`DocumentsSection.tsx`) e pela revisão do
 * dealer (`DocumentReviewCard.tsx`), que antes duplicavam a mesma lista.
 * `passaporte` é a opção pra comprador estrangeiro (Fase 8): CPF continua
 * obrigatório em `PersonalDataForm.tsx` — isto é só mais um tipo de
 * documento de identidade que pode ser enviado, não um substituto do CPF.
 */
export const DOCUMENT_TYPES: DocumentTypeSpec[] = [
  {
    value: 'rg',
    label: 'RG',
    manualFields: [{ key: 'numeroDocumento', label: 'Número do documento', required: true }],
  },
  { value: 'cpf', label: 'CPF', manualFields: [] },
  {
    value: 'cnh',
    label: 'CNH',
    manualFields: [{ key: 'numeroDocumento', label: 'Número do documento', required: true }],
  },
  {
    value: 'passaporte',
    label: 'Passaporte (estrangeiros)',
    manualFields: [
      { key: 'numeroPassaporte', label: 'Número do passaporte', required: true },
      { key: 'paisEmissor', label: 'País emissor', required: true },
      { key: 'validade', label: 'Validade (opcional)', required: false },
    ],
  },
  { value: 'comprovante_renda', label: 'Comprovante de renda', manualFields: [] },
  { value: 'comprovante_residencia', label: 'Comprovante de residência', manualFields: [] },
]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = Object.fromEntries(
  DOCUMENT_TYPES.map((spec) => [spec.value, spec.label]),
) as Record<DocumentType, string>
