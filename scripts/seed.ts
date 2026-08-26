import { getDb } from '../api/_lib/db'
import { dealerUsers } from '../api/_lib/schema'
import { hashPassword } from '../api/_lib/auth'

/**
 * Cria (ou reaproveita, se já existir) um usuário dealer para dev local —
 * sem isto não há como logar no painel da loja num banco recém-migrado.
 * Nunca rode isto apontando para um `DATABASE_URL` de produção com uma senha
 * padrão: é só para o PGlite local.
 */
async function main() {
  const db = await getDb()
  const email = process.env.SEED_DEALER_EMAIL ?? 'dealer@credpronto.dev'
  const password = process.env.SEED_DEALER_PASSWORD ?? 'credpronto123'

  await db
    .insert(dealerUsers)
    .values({
      name: 'Dealer Dev',
      email,
      passwordHash: hashPassword(password),
      role: 'admin',
    })
    .onConflictDoNothing({ target: dealerUsers.email })

  console.log(`Seed ok — login com ${email} / ${password}`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
