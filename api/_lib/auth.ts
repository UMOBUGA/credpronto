import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { applications, dealerUsers, type Application, type DealerUser } from './schema'
import { sendJson } from './http'

const SCRYPT_KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Mesmo padrão de fallback de dev de `crypto.ts` — nunca usar em produção. */
function getSessionSecret(): string {
  return process.env.SESSION_SECRET ?? 'credpronto-dev-only-insecure-session-secret'
}

export const SESSION_COOKIE_NAME = 'credpronto_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

interface SessionPayload {
  userId: string
  expiresAt: number
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = { userId, expiresAt: Date.now() + SESSION_TTL_MS }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', getSessionSecret()).update(payloadB64).digest('hex')
  return `${payloadB64}.${signature}`
}

function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null
  const [payloadB64, signature] = token.split('.')
  if (!payloadB64 || !signature) return null

  const expectedSignature = createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('hex')
  const expectedBuf = Buffer.from(expectedSignature)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null
  }

  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8'),
  ) as SessionPayload
  if (payload.expiresAt < Date.now()) return null
  return payload
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const entries = header.split(';').map((part) => {
    const idx = part.indexOf('=')
    if (idx === -1) return [part.trim(), '']
    return [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())]
  })
  return Object.fromEntries(entries)
}

export async function getSessionUser(req: IncomingMessage, db: Db): Promise<DealerUser | null> {
  const cookies = parseCookies(req.headers.cookie)
  const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME])
  if (!payload) return null

  const [user] = await db
    .select()
    .from(dealerUsers)
    .where(eq(dealerUsers.id, payload.userId))
    .limit(1)
  if (!user || user.disabledAt) return null
  return user
}

/**
 * O token do portal do cliente é o "login" do proponente — alta entropia,
 * escopado a uma única proposta, com expiração. Sem sessão, sem senha: o
 * link é o segredo. `documents_pending`/etc. não têm relação com isso, é
 * puramente autenticação, a máquina de estados fica em `stateMachine.ts`.
 */
export async function getApplicationByToken(token: string, db: Db): Promise<Application | null> {
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.clientPortalToken, token))
    .limit(1)

  if (!application) return null
  if (application.clientPortalTokenExpiresAt.getTime() < Date.now()) return null
  return application
}

export function generateClientPortalToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Guards de rota compartilhados — cada handler autenticado começa chamando
 * um destes; se `null` voltar, a resposta 401/404 já foi enviada e o
 * handler só precisa dar `return`.
 */
export async function requireDealerSession(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
): Promise<DealerUser | null> {
  const user = await getSessionUser(req, db)
  if (!user) {
    sendJson(res, 401, { error: 'unauthorized' })
    return null
  }
  return user
}

/**
 * Igual a `requireDealerSession`, mas também barra papéis fora da lista —
 * usado por `applications/[id]/reveal.ts` (Fase 6), restrito a
 * admin/manager: um analyst pode operar a esteira sem poder revelar CPF/
 * renda em claro.
 */
export async function requireDealerRole(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  allowedRoles: DealerUser['role'][],
): Promise<DealerUser | null> {
  const user = await requireDealerSession(req, res, db)
  if (!user) return null
  if (!allowedRoles.includes(user.role)) {
    sendJson(res, 403, { error: 'forbidden' })
    return null
  }
  return user
}

export async function requireApplicationByToken(
  res: ServerResponse,
  db: Db,
  token: string,
): Promise<Application | null> {
  const application = await getApplicationByToken(token, db)
  if (!application) {
    sendJson(res, 404, { error: 'not_found' })
    return null
  }
  return application
}
