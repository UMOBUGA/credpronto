import { randomUUID } from 'node:crypto'
import type { Db } from './db'
import {
  applicants,
  applications,
  dealerUsers,
  type Applicant,
  type Application,
  type DealerUser,
} from './schema'
import { encryptField, hashForLookup } from './crypto'
import { generateClientPortalToken, hashPassword } from './auth'

/**
 * Helpers só de teste (mora em `_lib`, ignorado como rota pelo Vercel). Cada
 * chamada gera dados únicos (e-mail/CPF aleatórios) porque `getDb()` cacheia
 * uma única instância por arquivo de teste — várias chamadas no mesmo
 * arquivo compartilham o banco em memória.
 */
export async function seedDealerUser(
  db: Db,
  role: DealerUser['role'] = 'admin',
): Promise<DealerUser> {
  const [user] = await db
    .insert(dealerUsers)
    .values({
      name: 'Dealer de teste',
      email: `dealer-${randomUUID()}@example.test`,
      passwordHash: hashPassword('senha-teste'),
      role,
    })
    .returning()
  return user!
}

export async function seedApplicant(db: Db): Promise<Applicant> {
  const cpf = String(Math.floor(10000000000 + Math.random() * 89999999999))
  const [applicant] = await db
    .insert(applicants)
    .values({
      fullNameEncrypted: encryptField('Fulano de Teste'),
      cpfEncrypted: encryptField(cpf),
      cpfHash: hashForLookup(cpf),
      phoneEncrypted: encryptField('11999990000'),
      emailEncrypted: encryptField(`fulano-${randomUUID()}@example.test`),
    })
    .returning()
  return applicant!
}

export async function seedApplication(
  db: Db,
  params: {
    applicantId: string
    dealerUserId: string
    vehicleMake?: string
    vehicleModel?: string
    vehiclePlate?: string
  },
): Promise<Application> {
  const [application] = await db
    .insert(applications)
    .values({
      applicantId: params.applicantId,
      dealerUserId: params.dealerUserId,
      vehicleMake: params.vehicleMake ?? 'Fiat',
      vehicleModel: params.vehicleModel ?? 'Argo',
      vehicleYear: 2022,
      vehiclePrice: 80000,
      vehiclePlate: params.vehiclePlate ?? 'ABC1D23',
      downPayment: 10000,
      requestedAmount: 70000,
      requestedTermMonths: 48,
      clientPortalToken: generateClientPortalToken(),
      clientPortalTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning()
  return application!
}
