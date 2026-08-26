import { randomUUID } from 'node:crypto'
import { and, eq, inArray, lt, ne, or } from 'drizzle-orm'
import { getDb } from '../_lib/db'
import { applicants, applications, documentExtractions, documents } from '../_lib/schema'
import { encryptField, hashForLookup } from '../_lib/crypto'
import { logAction } from '../_lib/audit'
import { RETENTION_ELIGIBLE_STATUSES } from '../_lib/stateMachine'
import { deleteDocument } from '../_lib/storage'
import { getUrl, sendJson, type Handler } from '../_lib/http'

const DEFAULT_WINDOW_DAYS = 90
/** ~5 anos — mesma ordem de grandeza usada para guarda de registro financeiro no Brasil. */
const DEFAULT_ACCEPTED_WINDOW_DAYS = 1825
const ANONYMIZED_SENTINEL = '[dado anonimizado]'
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Roda 1x/dia (ver `crons` em vercel.json). Anonimiza nome/CPF/documentos/
 * extrações de propostas paradas há tempo demais num estado terminal
 * não-aceito (`denied`/`expired`/`cancelled`/`offer_declined`, janela curta
 * — `RETENTION_WINDOW_DAYS`, padrão 90 dias) ou aceito (`offer_accepted`,
 * janela própria e mais longa — `RETENTION_WINDOW_ACCEPTED_DAYS`, padrão
 * ~5 anos). `?dryRun=true` reporta o que seria anonimizado sem escrever
 * nada — pensado para inspecionar o efeito antes de agendar o cron de
 * verdade. Protegido por `CRON_SECRET`, mesmo padrão do painel-do-ar.
 */
const handler: Handler = async (req, res) => {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const authorization = req.headers.authorization
    if (authorization !== `Bearer ${expected}`) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
  }

  const dryRun = getUrl(req).searchParams.get('dryRun') === 'true'
  const windowDays = Number(process.env.RETENTION_WINDOW_DAYS ?? DEFAULT_WINDOW_DAYS)
  const acceptedWindowDays = Number(
    process.env.RETENTION_WINDOW_ACCEPTED_DAYS ?? DEFAULT_ACCEPTED_WINDOW_DAYS,
  )
  const cutoff = new Date(Date.now() - windowDays * DAY_MS)
  const acceptedCutoff = new Date(Date.now() - acceptedWindowDays * DAY_MS)

  const db = await getDb()
  const candidates = await db
    .select()
    .from(applications)
    .where(
      or(
        and(
          inArray(applications.status, RETENTION_ELIGIBLE_STATUSES),
          lt(applications.updatedAt, cutoff),
        ),
        and(eq(applications.status, 'offer_accepted'), lt(applications.updatedAt, acceptedCutoff)),
      ),
    )

  const actor = { actorType: 'cron' as const }
  const anonymized: string[] = []
  const skippedAlreadyDone: string[] = []
  const skippedActiveSibling: string[] = []

  for (const application of candidates) {
    const [applicant] = await db
      .select()
      .from(applicants)
      .where(eq(applicants.id, application.applicantId))
      .limit(1)
    if (!applicant || applicant.anonymizedAt) {
      skippedAlreadyDone.push(application.id)
      continue
    }

    // Cliente recorrente: `applications/index.ts` reaproveita o mesmo
    // `applicants` por CPF (dedupe), então mais de uma proposta pode
    // compartilhar o mesmo titular. Só anonimiza quando NENHUMA outra
    // proposta do titular ainda está em andamento — ela ainda precisa do
    // cadastro em claro.
    const siblings = await db
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(and(eq(applications.applicantId, applicant.id), ne(applications.id, application.id)))
    const hasActiveSibling = siblings.some(
      (sibling) =>
        !RETENTION_ELIGIBLE_STATUSES.includes(sibling.status) &&
        sibling.status !== 'offer_accepted',
    )
    if (hasActiveSibling) {
      skippedActiveSibling.push(application.id)
      continue
    }

    if (!dryRun) {
      const docs = await db
        .select()
        .from(documents)
        .where(eq(documents.applicationId, application.id))
      for (const doc of docs) {
        await deleteDocument(doc.storageKey)
        await db.delete(documentExtractions).where(eq(documentExtractions.documentId, doc.id))
      }
      await db.delete(documents).where(eq(documents.applicationId, application.id))

      const sentinelCpf = randomUUID()
      await db
        .update(applicants)
        .set({
          fullNameEncrypted: encryptField(ANONYMIZED_SENTINEL),
          cpfEncrypted: encryptField(sentinelCpf),
          cpfHash: hashForLookup(sentinelCpf),
          birthDateEncrypted: null,
          phoneEncrypted: encryptField(ANONYMIZED_SENTINEL),
          emailEncrypted: encryptField(ANONYMIZED_SENTINEL),
          addressEncrypted: null,
          monthlyIncomeDeclaredEncrypted: null,
          anonymizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(applicants.id, applicant.id))

      await logAction(db, actor, {
        action: 'applicant.anonymized',
        entityType: 'applicant',
        entityId: applicant.id,
        applicationId: application.id,
        metadata: { reason: 'retention_sweep', statusAtSweep: application.status },
      })
    }

    anonymized.push(application.id)
  }

  sendJson(res, 200, {
    ok: true,
    dryRun,
    anonymizedCount: anonymized.length,
    anonymized,
    skippedAlreadyDone,
    skippedActiveSibling,
  })
}

export default handler
