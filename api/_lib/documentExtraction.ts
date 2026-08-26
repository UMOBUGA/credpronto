import { desc, eq } from 'drizzle-orm'
import type { Db } from './db'
import {
  documentExtractions,
  documents,
  type DocumentExtraction,
  type DocumentType,
} from './schema'
import { getDocument } from './storage'
import { extractDocument } from './claude'
import { encryptField } from './crypto'
import { isValidCpf } from './cpfValidation'

const CONFIDENCE_THRESHOLD = 0.75
const DOCUMENT_TYPES_WITH_CPF = new Set<DocumentType>(['rg', 'cpf', 'cnh'])

export interface RunExtractionResult {
  documentStatus: 'extracted' | 'failed'
  extractionStatus: 'auto_accepted' | 'needs_review' | null
}

/**
 * Pipeline único de extração — chamado tanto pelo upload do cliente (que
 * roda isso de forma síncrona logo após salvar o documento, ver nota em
 * `api/client/[token]/documents.ts`) quanto pelo retry manual do dealer
 * (`api/documents/[id]/extract.ts`). Nunca propaga um erro esperado (falha
 * de API, saída malformada) — sempre resolve com um status, o chamador não
 * precisa de try/catch pra isso. Só um `document_id` inexistente lança.
 */
export async function runExtraction(db: Db, documentId: string): Promise<RunExtractionResult> {
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!document) {
    throw new Error(`Documento não encontrado: ${documentId}`)
  }

  await db.update(documents).set({ status: 'extracting' }).where(eq(documents.id, documentId))

  try {
    const buffer = await getDocument(document.storageKey)
    const result = await extractDocument(
      buffer.toString('base64'),
      document.mimeType,
      document.type,
    )

    const requiresCpf = DOCUMENT_TYPES_WITH_CPF.has(document.type)
    const cpfValue = result.fields.cpf
    const cpfOk = !requiresCpf || (cpfValue !== undefined && isValidCpf(cpfValue))
    const needsReview =
      result.confidence < CONFIDENCE_THRESHOLD || result.issues.length > 0 || !cpfOk

    const extractionStatus = needsReview ? 'needs_review' : 'auto_accepted'

    await db.insert(documentExtractions).values({
      documentId,
      extractedFieldsEncrypted: encryptField(JSON.stringify(result.fields)),
      confidenceScore: result.confidence,
      modelUsed: result.modelUsed,
      status: extractionStatus,
    })
    await db.update(documents).set({ status: 'extracted' }).where(eq(documents.id, documentId))

    return { documentStatus: 'extracted', extractionStatus }
  } catch {
    await db.update(documents).set({ status: 'failed' }).where(eq(documents.id, documentId))
    return { documentStatus: 'failed', extractionStatus: null }
  }
}

/**
 * A tentativa mais recente de extração de um documento — cada retry insere
 * uma linha nova (`runExtraction` acima nunca sobrescreve), então "a
 * extração atual" sempre significa "a mais recente". Compartilhado entre
 * `api/bureau/check.ts` (bloqueio de avanço + dado pro anti-fraude) e
 * `api/applications/[id].ts` (tela de revisão do dealer).
 */
export async function getLatestExtraction(
  db: Db,
  documentId: string,
): Promise<DocumentExtraction | null> {
  const [latest] = await db
    .select()
    .from(documentExtractions)
    .where(eq(documentExtractions.documentId, documentId))
    .orderBy(desc(documentExtractions.createdAt))
    .limit(1)
  return latest ?? null
}
