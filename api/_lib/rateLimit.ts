import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendJson } from './http'

/**
 * Limitador de janela fixa, em memória de processo. Limitação de escopo de
 * portfólio documentada: cada instância serverless tem seu próprio mapa, sem
 * coordenação entre invocações concorrentes — em produção de verdade isso
 * seria Redis/Upstash, igual à `ENCRYPTION_KEY` única em vez de um KMS (ver
 * `crypto.ts`). Ainda assim reduz o caso óbvio de força bruta contra login e
 * contra os endpoints de token do cliente (que não têm senha, só o token em
 * si como segredo), e funciona de verdade no dev server local (processo
 * único) e dentro da vida de uma mesma instância em produção.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim()
  }
  // `req.socket` não existe em `mockReq` (testHttp.ts) — os testes não
  // simulam um socket real de propósito (ver comentário lá), então este
  // acesso precisa ser opcional em vez de assumir um IncomingMessage real.
  return req.socket?.remoteAddress ?? 'unknown'
}

/**
 * `true` = requisição liberada. `false` = já enviou 429 com `Retry-After`;
 * o handler só precisa dar `return`, mesmo padrão dos guards de `auth.ts`.
 */
export function enforceRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  routeKey: string,
  limit: number,
  windowMs: number,
): boolean {
  const key = `${routeKey}:${getClientIp(req)}`
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (bucket.count >= limit) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
    sendJson(res, 429, { error: 'rate_limited' })
    return false
  }

  bucket.count++
  return true
}
