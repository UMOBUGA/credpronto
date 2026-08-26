import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Helper só de teste (mora em `_lib` porque o Vercel ignora pastas com "_" ao
 * montar as rotas de `api/`, então isso nunca vira um endpoint por engano).
 * Os handlers só leem `req.url`/`req.headers`/o corpo via stream e chamam
 * `res.setHeader`/`res.end`, então um objeto plano é suficiente — não precisa
 * de um socket real por trás de `IncomingMessage`/`ServerResponse`.
 */
export function mockReq(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): IncomingMessage {
  const { method = 'GET', headers = {}, body } = options
  const bodyChunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  let index = 0

  return {
    url,
    method,
    headers,
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (index < bodyChunks.length) {
            return { value: bodyChunks[index++], done: false }
          }
          return { value: undefined, done: true }
        },
      }
    },
  } as unknown as IncomingMessage
}

export interface MockRes {
  statusCode: number
  headers: Record<string, string>
  body: unknown
  rawBody: Buffer | undefined
}

/**
 * `end()` aceita string (a maioria dos handlers, via `sendJson`) ou Buffer
 * (handlers que devolvem bytes crus, ex.: `api/documents/[id]/file.ts`).
 * `body` só é populado quando o chunk é um JSON válido — pra binário, leia
 * `rawBody`.
 */
export function mockRes(): ServerResponse & MockRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    rawBody: undefined as Buffer | undefined,
    setHeader(key: string, value: string) {
      res.headers[key] = value
      return res
    },
    end(chunk?: string | Buffer) {
      if (Buffer.isBuffer(chunk)) {
        res.rawBody = chunk
        return res
      }
      if (chunk) {
        res.rawBody = Buffer.from(chunk)
        try {
          res.body = JSON.parse(chunk)
        } catch {
          // não-JSON — só rawBody fica disponível
        }
      }
      return res
    },
  }
  return res as unknown as ServerResponse & MockRes
}
