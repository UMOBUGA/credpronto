import { getDb } from '../_lib/db'
import { getSessionUser } from '../_lib/auth'
import { sendJson, type Handler } from '../_lib/http'

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await getSessionUser(req, db)
  if (!user) {
    sendJson(res, 200, { user: null })
    return
  }
  sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } })
}

export default handler
