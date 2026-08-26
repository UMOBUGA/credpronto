import { http, HttpResponse } from 'msw'

/**
 * Handlers padrão para que testes que não são sobre um endpoint específico
 * não caiam em "unhandled request" — mesma convenção do painel-do-ar. Testes
 * que exercitam um fluxo específico sobrescrevem com `server.use(...)`.
 */
export const handlers = [
  http.get('/api/auth/session', () => HttpResponse.json({ user: null })),
  http.get('/api/applications', () => HttpResponse.json([])),
  http.get('/api/client/:token', () => HttpResponse.json({ error: 'not_found' }, { status: 404 })),
]
