import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { Db } from './db'
import type { AuditActor } from './audit'
import { logAction } from './audit'

/**
 * AES-256-GCM em nível de aplicação para campos sensíveis (CPF, renda,
 * endereço, tokens do Open Finance). Uma `ENCRYPTION_KEY` mestra (64 hex =
 * 32 bytes) documentada no README como simplificação de portfólio — em
 * produção de verdade isso seria uma chave de um KMS gerenciado, não uma env
 * var. As chaves de cifra e de hash são derivadas da mesma mestra via HMAC
 * (domínios separados a partir de um único secret), não dois secrets para o
 * usuário gerenciar.
 *
 * Sem `ENCRYPTION_KEY` definida (dev/test), cai numa chave fixa e claramente
 * não-secreta — mesmo padrão de "zero config para desenvolver" de
 * `db.ts` (ausência de `DATABASE_URL` → PGlite). Nunca use isso em produção:
 * o build de produção deve sempre ter `ENCRYPTION_KEY` definida.
 */
const DEV_FALLBACK_SEED = 'credpronto-dev-only-insecure-key-never-use-in-production'

function getMasterKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (hex) {
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error('ENCRYPTION_KEY precisa ser uma string hex de 64 caracteres (32 bytes)')
    }
    return Buffer.from(hex, 'hex')
  }
  return createHash('sha256').update(DEV_FALLBACK_SEED).digest()
}

function deriveKey(purpose: 'encrypt' | 'hash'): Buffer {
  return createHmac('sha256', getMasterKey()).update(purpose).digest()
}

export function encryptField(plaintext: string): string {
  const key = deriveKey('encrypt')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, ciphertext].map((buf) => buf.toString('base64')).join('.')
}

function decryptRaw(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Formato de campo criptografado inválido')
  }
  const key = deriveKey('encrypt')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

/**
 * HMAC-SHA256 não-reversível — permite busca por igualdade (ex.: dedupe de
 * `applicants.cpfHash`) sem nunca decriptar o valor original.
 */
export function hashForLookup(value: string): string {
  return createHmac('sha256', deriveKey('hash')).update(value).digest('hex')
}

export interface DecryptFieldContext {
  db: Db
  actor: AuditActor
  entityType: string
  entityId: string
  field: string
  applicationId?: string
  /**
   * Sobrescreve o rótulo padrão `'pii.decrypted'` — usado por
   * `api/applications/[id]/reveal.ts` (Fase 6) pra marcar `'pii.revealed'`:
   * uma ação humana deliberada de "clicar em revelar" na UI, distinta de
   * uma decriptação interna rotineira (ex.: calcular DTI durante a
   * decisão). Mesma trilha de auditoria, rótulo diferente.
   */
  action?: string
}

/**
 * Único caminho de leitura de campo cifrado. Sempre grava uma linha em
 * `audit_log` (`action: 'pii.decrypted'` por padrão) — auditoria de acesso
 * a PII é uma propriedade estrutural do código, não uma convenção que dá
 * pra esquecer.
 */
export async function decryptField(payload: string, ctx: DecryptFieldContext): Promise<string> {
  const plaintext = decryptRaw(payload)
  await logAction(ctx.db, ctx.actor, {
    action: ctx.action ?? 'pii.decrypted',
    entityType: ctx.entityType,
    entityId: ctx.entityId,
    applicationId: ctx.applicationId,
    metadata: { field: ctx.field },
  })
  return plaintext
}
