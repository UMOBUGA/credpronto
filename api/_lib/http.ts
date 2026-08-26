import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Os handlers em `api/` são funções Node puras `(req, res)` — de propósito,
 * sem depender de `req.query`/`req.body` (augmentações que só existem no
 * runtime do Vercel). Isso é o que permite o mesmo arquivo rodar idêntico em
 * produção e no middleware de dev do Vite (`vite.api-plugin.ts`).
 */
export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export function getUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost')
}

export function lastPathSegment(req: IncomingMessage): string {
  const segments = getUrl(req).pathname.split('/').filter(Boolean)
  return decodeURIComponent(segments[segments.length - 1] ?? '')
}

export function pathSegment(req: IncomingMessage, indexFromEnd: number): string {
  const segments = getUrl(req).pathname.split('/').filter(Boolean)
  return decodeURIComponent(segments[segments.length - 1 - indexFromEnd] ?? '')
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  return raw ? (JSON.parse(raw) as T) : ({} as T)
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cacheControl?: string,
): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (cacheControl) res.setHeader('Cache-Control', cacheControl)
  res.end(JSON.stringify(body))
}
