import { eq } from 'drizzle-orm'
import { getDb, type Db } from '../api/_lib/db'
import {
  applicants,
  applications,
  antifraudChecks,
  bureauChecks,
  creditDecisions,
  dealerUsers,
  loanOffers,
  vehicleChecks,
  type ApplicationStatus,
} from '../api/_lib/schema'
import { hashPassword, generateClientPortalToken } from '../api/_lib/auth'
import { encryptField, hashForLookup } from '../api/_lib/crypto'

/**
 * Cria (ou reaproveita, se já existir) um usuário dealer para dev local —
 * sem isto não há como logar no painel da loja num banco recém-migrado.
 * Nunca rode isto apontando para um `DATABASE_URL` de produção com uma senha
 * padrão: é só para o PGlite local.
 */
async function seedDealer(db: Db) {
  const email = process.env.SEED_DEALER_EMAIL ?? 'dealer@credpronto.dev'
  const password = process.env.SEED_DEALER_PASSWORD ?? 'credpronto123'

  const [dealer] = await db
    .insert(dealerUsers)
    .values({
      name: 'Dealer Dev',
      email,
      passwordHash: hashPassword(password),
      role: 'admin',
    })
    .onConflictDoNothing({ target: dealerUsers.email })
    .returning()

  console.log(`Seed ok — login com ${email} / ${password}`)
  return (
    dealer ?? (await db.select().from(dealerUsers).where(eq(dealerUsers.email, email)).limit(1))[0]!
  )
}

interface DemoApplicantInput {
  fullName: string
  cpf: string
  phone: string
  email: string
  birthDate?: string
  monthlyIncomeDeclared?: number
}

async function insertDemoApplicant(db: Db, input: DemoApplicantInput) {
  const [applicant] = await db
    .insert(applicants)
    .values({
      fullNameEncrypted: encryptField(input.fullName),
      cpfEncrypted: encryptField(input.cpf),
      cpfHash: hashForLookup(input.cpf),
      phoneEncrypted: encryptField(input.phone),
      emailEncrypted: encryptField(input.email),
      birthDateEncrypted: input.birthDate ? encryptField(input.birthDate) : null,
      monthlyIncomeDeclaredEncrypted:
        input.monthlyIncomeDeclared != null
          ? encryptField(String(input.monthlyIncomeDeclared))
          : null,
    })
    .returning()
  return applicant!
}

/**
 * Propostas sintéticas cobrindo os principais estados da esteira, pra o
 * painel do dealer não ficar vazio na primeira vez que alguém clona o
 * projeto. **Dado inteiramente fictício** (nomes/CPFs/placas inventados,
 * nunca de pessoas reais) — ver aviso no README. Inserido direto nas
 * tabelas, sem passar por `transition()`/`logAction()`: é histórico
 * fabricado pra demonstração, não uma sequência real de eventos, então não
 * faria sentido aparecer na trilha de auditoria como se fosse.
 */
async function seedDemoApplications(db: Db, dealerId: string) {
  const [already] = await db.select({ id: applications.id }).from(applications).limit(1)
  if (already) {
    console.log('Já existem propostas no banco — pulando seed de propostas de exemplo.')
    return
  }

  async function baseApplication(params: {
    applicant: DemoApplicantInput
    vehicleMake: string
    vehicleModel: string
    vehicleYear: number
    vehiclePrice: number
    vehiclePlate: string
    requestedAmount: number
    status: ApplicationStatus
  }) {
    const applicant = await insertDemoApplicant(db, params.applicant)
    const [application] = await db
      .insert(applications)
      .values({
        applicantId: applicant.id,
        dealerUserId: dealerId,
        vehicleMake: params.vehicleMake,
        vehicleModel: params.vehicleModel,
        vehicleYear: params.vehicleYear,
        vehiclePrice: params.vehiclePrice,
        vehiclePlate: params.vehiclePlate,
        downPayment: Math.round(params.vehiclePrice * 0.15),
        requestedAmount: params.requestedAmount,
        requestedTermMonths: 48,
        status: params.status,
        clientPortalToken: generateClientPortalToken(),
        clientPortalTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning()
    return { applicant, application: application! }
  }

  await baseApplication({
    applicant: {
      fullName: 'Ana Exemplo',
      cpf: '11144477735',
      phone: '11999990001',
      email: 'ana.exemplo@example.test',
    },
    vehicleMake: 'Fiat',
    vehicleModel: 'Mobi',
    vehicleYear: 2023,
    vehiclePrice: 65000,
    vehiclePlate: 'DEM0A01',
    requestedAmount: 55000,
    status: 'link_sent',
  })

  const { application: manualReviewApp } = await baseApplication({
    applicant: {
      fullName: 'Bruno Exemplo',
      cpf: '39053344705',
      phone: '11999990002',
      email: 'bruno.exemplo@example.test',
      birthDate: '1988-04-12',
      monthlyIncomeDeclared: 6000,
    },
    vehicleMake: 'VW',
    vehicleModel: 'Polo',
    vehicleYear: 2022,
    vehiclePrice: 92000,
    vehiclePlate: 'DEM0B02',
    requestedAmount: 85000,
    status: 'manual_review',
  })
  await db.insert(bureauChecks).values({
    applicationId: manualReviewApp.id,
    score: 640,
    hasRestriction: false,
  })
  await db.insert(vehicleChecks).values({
    applicationId: manualReviewApp.id,
    restrictionFound: false,
    source: 'mock-vehicle-restriction',
  })
  await db.insert(antifraudChecks).values({
    applicationId: manualReviewApp.id,
    riskScore: 55,
    flagsJson: ['name_mismatch'],
    provider: 'mock-fraud-db+cross-validation',
  })
  await db.insert(creditDecisions).values({
    applicationId: manualReviewApp.id,
    outcome: 'manual_review',
    scoreUsed: 640,
    factorsJson: {
      note: 'Divergência de nome entre cadastro e documento — revisão humana necessária.',
    },
  })

  const { application: approvedApp } = await baseApplication({
    applicant: {
      fullName: 'Carla Exemplo',
      cpf: '15350946056',
      phone: '11999990003',
      email: 'carla.exemplo@example.test',
      birthDate: '1990-09-30',
      monthlyIncomeDeclared: 12000,
    },
    vehicleMake: 'Toyota',
    vehicleModel: 'Corolla',
    vehicleYear: 2023,
    vehiclePrice: 145000,
    vehiclePlate: 'DEM0C03',
    requestedAmount: 110000,
    status: 'offer_created',
  })
  await db.insert(bureauChecks).values({
    applicationId: approvedApp.id,
    score: 810,
    hasRestriction: false,
  })
  await db.insert(vehicleChecks).values({
    applicationId: approvedApp.id,
    restrictionFound: false,
    source: 'mock-vehicle-restriction',
  })
  await db.insert(antifraudChecks).values({
    applicationId: approvedApp.id,
    riskScore: 5,
    flagsJson: [],
    provider: 'mock-fraud-db+cross-validation',
  })
  await db.insert(creditDecisions).values({
    applicationId: approvedApp.id,
    outcome: 'approved',
    scoreUsed: 810,
    factorsJson: { note: 'Score alto, DTI baixo, sem restrições.' },
    riskNarrativeDealer:
      'Score de crédito alto e comprometimento de renda baixo — aprovação dentro da regra padrão.',
    riskNarrativeApplicant: 'Sua proposta foi aprovada! Em breve enviaremos os próximos passos.',
  })
  await db.insert(loanOffers).values({
    applicationId: approvedApp.id,
    amount: 110000,
    termMonths: 48,
    interestRate: 0.0199,
    monthlyPayment: 3150.42,
    status: 'draft',
  })

  const { application: deniedApp } = await baseApplication({
    applicant: {
      fullName: 'Daniel Exemplo',
      cpf: '84893141059',
      phone: '11999990004',
      email: 'daniel.exemplo@example.test',
      birthDate: '1979-01-20',
      monthlyIncomeDeclared: 3200,
    },
    vehicleMake: 'Hyundai',
    vehicleModel: 'HB20',
    vehicleYear: 2021,
    vehiclePrice: 78000,
    vehiclePlate: 'DEM0D04',
    requestedAmount: 70000,
    status: 'denied',
  })
  await db.insert(bureauChecks).values({
    applicationId: deniedApp.id,
    score: 380,
    hasRestriction: true,
    restrictionDetailsJson: { tipo: 'divida_vencida', valor: 4200 },
  })
  await db.insert(vehicleChecks).values({
    applicationId: deniedApp.id,
    restrictionFound: false,
    source: 'mock-vehicle-restriction',
  })
  await db.insert(antifraudChecks).values({
    applicationId: deniedApp.id,
    riskScore: 10,
    flagsJson: [],
    provider: 'mock-fraud-db+cross-validation',
  })
  await db.insert(creditDecisions).values({
    applicationId: deniedApp.id,
    outcome: 'denied',
    scoreUsed: 380,
    factorsJson: { note: 'Restrição ativa no bureau (simulado) e score abaixo do mínimo.' },
    riskNarrativeDealer:
      'Score baixo combinado com restrição ativa no bureau — negativa automática pela regra.',
    riskNarrativeApplicant: 'Infelizmente sua proposta não foi aprovada neste momento.',
  })

  console.log(
    'Seed ok — 4 propostas de exemplo criadas (link_sent, manual_review, offer_created, denied).',
  )
}

async function main() {
  const db = await getDb()
  const dealer = await seedDealer(db)
  await seedDemoApplications(db, dealer.id)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
