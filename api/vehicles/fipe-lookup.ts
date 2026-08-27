import { z } from 'zod'
import { getDb } from '../_lib/db'
import { lookupFipeValue } from '../_lib/fipe'
import { requireDealerSession } from '../_lib/auth'
import { getUrl, sendJson, type Handler } from '../_lib/http'

const querySchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce.number().int(),
})

/**
 * Wrapper fino em torno de `lookupFipeValue()` (BrasilAPI, real — ver
 * `api/_lib/fipe.ts`) — antes ela só rodava dentro de `api/bureau/check.ts`,
 * bem depois no fluxo (só depois do cliente preencher tudo). Este endpoint
 * deixa a consulta disponível já na tela de criação da proposta (Fase 9),
 * pra avaliar se o preço/valor pedido faz sentido antes de gerar o link pro
 * cliente. Puramente informativo: não persiste nada, não altera a proposta
 * — `decision.ts` continua o único lugar que de fato decide algo (ver
 * CLAUDE.md).
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const url = getUrl(req)
  const parsed = querySchema.safeParse({
    make: url.searchParams.get('make') ?? undefined,
    model: url.searchParams.get('model') ?? undefined,
    year: url.searchParams.get('year') ?? undefined,
  })
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_query' })
    return
  }

  const result = await lookupFipeValue(parsed.data.make, parsed.data.model, parsed.data.year)
  sendJson(res, 200, result)
}

export default handler
