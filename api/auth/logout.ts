import { clearSessionCookieHeader } from '../_lib/auth'
import { sendJson, type Handler } from '../_lib/http'

const handler: Handler = async (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookieHeader())
  sendJson(res, 200, { ok: true })
}

export default handler
