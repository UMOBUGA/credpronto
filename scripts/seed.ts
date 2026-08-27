import { eq } from 'drizzle-orm'
import { getDb, type Db } from '../api/_lib/db'
import {
  applicants,
  applications,
  antifraudChecks,
  bureauChecks,
  consentRecords,
  creditDecisions,
  dealerUsers,
  documentExtractions,
  documents,
  loanOffers,
  openfinanceConsents,
  openfinanceData,
  vehicleChecks,
  type ApplicationStatus,
  type DocumentType,
} from '../api/_lib/schema'
import { hashPassword, generateClientPortalToken } from '../api/_lib/auth'
import { encryptField, hashForLookup } from '../api/_lib/crypto'
import { checkBureauMock } from '../api/_lib/bureau'
import { checkVehicleRestrictionMock } from '../api/_lib/vehicleRestriction'
import { checkAntifraud } from '../api/_lib/antifraud'
import { decide, type DecisionInput } from '../api/_lib/decision'
import { lookupFipeValue } from '../api/_lib/fipe'
import { getOpenFinanceClient } from '../api/_lib/openfinance'
import { calculateMonthlyPayment, FIXED_MONTHLY_RATE } from '../api/applications/[id]/offer'

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

/**
 * Troca temporariamente uma env var `MOCK_*_SCENARIO` pra forçar um cenário
 * específico dos mocks determinísticos (`bureau.ts`/`vehicleRestriction.ts`/
 * `antifraud.ts`) durante o seed, sem depender de achar por tentativa um
 * CPF/placa cujo hash caia no cenário certo. Restaura o valor original (ou
 * remove) depois — o script inteiro é síncrono nesse trecho, então não há
 * risco de outra chamada concorrente ver o valor trocado.
 */
function withScenario<T>(envVar: string, value: string, fn: () => T): T {
  const original = process.env[envVar]
  process.env[envVar] = value
  try {
    return fn()
  } finally {
    if (original === undefined) delete process.env[envVar]
    else process.env[envVar] = original
  }
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

type ConsentTypeValue =
  'data_processing' | 'bureau_check' | 'ai_narrative_share' | 'openfinance_share'
const PRIVACY_POLICY_VERSION = '2026-08-26'

async function insertConsents(
  db: Db,
  applicantId: string,
  applicationId: string,
  types: ConsentTypeValue[],
) {
  if (types.length === 0) return
  await db.insert(consentRecords).values(
    types.map((consentType) => ({
      applicantId,
      applicationId,
      consentType,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    })),
  )
}

async function insertDocument(
  db: Db,
  applicationId: string,
  params: {
    type: DocumentType
    manualFields?: Record<string, string>
    extraction?: {
      fields: Record<string, string>
      confidenceScore: number
      status: 'auto_accepted' | 'needs_review'
    }
  },
) {
  const [document] = await db
    .insert(documents)
    .values({
      applicationId,
      type: params.type,
      storageKey: 'seed-placeholder.jpg',
      mimeType: 'image/jpeg',
      uploadedBy: 'applicant',
      status: params.extraction ? 'extracted' : 'uploaded',
      manualFieldsEncrypted: params.manualFields
        ? encryptField(JSON.stringify(params.manualFields))
        : null,
    })
    .returning()

  if (params.extraction) {
    await db.insert(documentExtractions).values({
      documentId: document!.id,
      extractedFieldsEncrypted: encryptField(JSON.stringify(params.extraction.fields)),
      confidenceScore: params.extraction.confidenceScore,
      modelUsed: 'claude-opus-5',
      status: params.extraction.status,
    })
  }

  return document!
}

/** Fluxo completo do Open Finance simulado (Fase 5) — mesmo client mock que a esteira usa de verdade. */
async function insertOpenFinanceAuthorized(db: Db, applicationId: string, cpf: string) {
  const client = getOpenFinanceClient()
  const { providerConsentId } = await client.initiateConsent(cpf)
  const tokens = await client.authorize(providerConsentId)
  const data = await client.fetchAccountData(tokens.accessToken, cpf)

  const [consent] = await db
    .insert(openfinanceConsents)
    .values({
      applicationId,
      providerConsentId,
      status: 'authorized',
      scopesJson: ['accounts', 'transactions'],
      accessTokenEncrypted: encryptField(tokens.accessToken),
      refreshTokenEncrypted: encryptField(tokens.refreshToken),
      authorizedAt: new Date(),
      expiresAt: tokens.expiresAt,
    })
    .returning()

  await db.insert(openfinanceData).values([
    {
      consentId: consent!.id,
      dataType: 'accounts',
      payloadEncrypted: encryptField(JSON.stringify(data.accounts)),
    },
    {
      consentId: consent!.id,
      dataType: 'transactions',
      payloadEncrypted: encryptField(JSON.stringify(data.transactions)),
    },
    {
      consentId: consent!.id,
      dataType: 'income',
      payloadEncrypted: encryptField(String(data.monthlyIncomeEstimate)),
    },
  ])

  return data.monthlyIncomeEstimate
}

async function insertOpenFinanceRejected(db: Db, applicationId: string) {
  await db.insert(openfinanceConsents).values({
    applicationId,
    providerConsentId: `seed-denied-${applicationId}`,
    status: 'rejected',
    scopesJson: ['accounts', 'transactions'],
  })
}

interface ChecksParams {
  applicationId: string
  vehiclePlate: string
  declaredCpf: string
  declaredFullName: string
  birthDate: string | null
  requestedAmount: number
  requestedTermMonths: number
  monthlyIncomeDeclared: number
  bureauScenario: 'clean' | 'restricted'
  vehicleScenario: 'clean' | 'restricted'
  extractedCpf?: string | null
  extractedFullName?: string | null
  fipeValue?: number | null
  fipeCode?: string | null
  fipeBrand?: string | null
  fipeModel?: string | null
  fipeYear?: string | null
  openfinanceVerified: boolean
  openfinanceIncomeEstimate: number | null
}

/**
 * Roda bureau + consulta veicular + anti-fraude e alimenta o MESMO motor de
 * decisão (`decide()`) que a esteira real usa — a decisão do seed é real,
 * calculada com regra de verdade em cima de dado mock, não um resultado
 * hardcoded desconectado da lógica. Grava as quatro tabelas
 * (`bureau_checks`/`vehicle_checks`/`antifraud_checks`/`credit_decisions`),
 * igual ao que `api/bureau/check.ts` + `api/applications/[id]/decision.ts`
 * fariam numa passagem real.
 */
async function runChecksAndDecide(db: Db, params: ChecksParams) {
  const bureau = withScenario('MOCK_BUREAU_SCENARIO', params.bureauScenario, () =>
    checkBureauMock(params.declaredCpf),
  )
  const [bureauCheck] = await db
    .insert(bureauChecks)
    .values({
      applicationId: params.applicationId,
      score: bureau.score,
      hasRestriction: bureau.hasRestriction,
      restrictionDetailsJson: bureau.restrictionDetails,
      rawResponseJson: bureau,
    })
    .returning()

  const vehicle = withScenario('MOCK_VEHICLE_SCENARIO', params.vehicleScenario, () =>
    checkVehicleRestrictionMock(params.vehiclePlate),
  )
  const [vehicleCheck] = await db
    .insert(vehicleChecks)
    .values({
      applicationId: params.applicationId,
      fipeValue: params.fipeValue ?? null,
      fipeCode: params.fipeCode ?? null,
      fipeBrand: params.fipeBrand ?? null,
      fipeModel: params.fipeModel ?? null,
      fipeYear: params.fipeYear ?? null,
      restrictionFound: vehicle.restrictionFound,
      restrictionDetailsJson: vehicle.restrictionDetails,
      source: params.fipeValue != null ? 'brasilapi-fipe+mock-detran' : 'mock-detran',
    })
    .returning()

  const antifraud = withScenario('MOCK_ANTIFRAUD_SCENARIO', 'clean', () =>
    checkAntifraud({
      declaredCpf: params.declaredCpf,
      declaredFullName: params.declaredFullName,
      extractedCpf: params.extractedCpf ?? null,
      extractedFullName: params.extractedFullName ?? null,
      birthDate: params.birthDate,
    }),
  )
  const [antifraudCheck] = await db
    .insert(antifraudChecks)
    .values({
      applicationId: params.applicationId,
      riskScore: antifraud.riskScore,
      flagsJson: antifraud.flags,
      provider: antifraud.provider,
    })
    .returning()

  const decisionInput: DecisionInput = {
    bureauScore: bureauCheck!.score,
    hasBureauRestriction: bureauCheck!.hasRestriction,
    requestedAmount: params.requestedAmount,
    monthlyIncomeDeclared: params.monthlyIncomeDeclared,
    requestedTermMonths: params.requestedTermMonths,
    vehicleRestrictionFound: vehicleCheck!.restrictionFound,
    fipeValue: vehicleCheck!.fipeValue,
    antifraudRiskScore: antifraudCheck!.riskScore,
    antifraudFlags: antifraudCheck!.flagsJson as string[],
    openfinanceVerified: params.openfinanceVerified,
    openfinanceIncomeEstimate: params.openfinanceIncomeEstimate,
  }
  const result = decide(decisionInput)

  const [decision] = await db
    .insert(creditDecisions)
    .values({
      applicationId: params.applicationId,
      outcome: result.outcome,
      scoreUsed: result.scoreUsed,
      factorsJson: result.factors,
    })
    .returning()

  return {
    bureauCheck: bureauCheck!,
    vehicleCheck: vehicleCheck!,
    antifraudCheck: antifraudCheck!,
    decision: decision!,
  }
}

/**
 * Parecer de IA não pode ser gerado de verdade no seed (exigiria
 * `ANTHROPIC_API_KEY` e uma chamada de rede a cada `npm run db:seed`) — os
 * dois textos abaixo são escritos à mão, coerentes com o `outcome` real que
 * `decide()` calculou, só pra a tela de detalhe não ficar com "parecer
 * ainda não disponível" nos casos que deveriam representar o fluxo já
 * concluído.
 */
const NARRATIVES: Record<
  'approved' | 'denied',
  { riskNarrativeDealer: string; riskNarrativeApplicant: string }
> = {
  approved: {
    riskNarrativeDealer:
      'Score de bureau alto, comprometimento de renda baixo e sem sinais de risco — aprovação dentro da regra padrão.',
    riskNarrativeApplicant: 'Sua proposta foi aprovada! Em breve enviaremos os próximos passos.',
  },
  denied: {
    riskNarrativeDealer:
      'Restrição encontrada na consulta veicular — a política nega financiamento de veículo com restrição, independente do restante do perfil.',
    riskNarrativeApplicant: 'Infelizmente sua proposta não foi aprovada neste momento.',
  },
}

/**
 * Propostas sintéticas cobrindo os principais estados da esteira e as
 * funcionalidades das 13 fases — reaproveita os mesmos mocks/motor de
 * decisão que a esteira real usa (nunca resultado hardcoded desconectado da
 * regra), pra o painel do dealer não ficar vazio nem artificial na primeira
 * vez que alguém clona o projeto. **Dado inteiramente fictício**
 * (nomes/CPFs/placas inventados, nunca de pessoas reais) — ver aviso no
 * README. Inserido direto nas tabelas, sem passar por
 * `transition()`/`logAction()`: é histórico fabricado pra demonstração, não
 * uma sequência real de eventos, então não faria sentido aparecer na trilha
 * de auditoria como se fosse.
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
    requestedTermMonths?: number
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
        requestedTermMonths: params.requestedTermMonths ?? 48,
        status: params.status,
        clientPortalToken: generateClientPortalToken(),
        clientPortalTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning()
    return { applicant, application: application! }
  }

  // 1) Link enviado — aguardando o comprador nem começar a preencher.
  await baseApplication({
    applicant: {
      fullName: 'Amanda Iniciante',
      cpf: '11144477735',
      phone: '11999990001',
      email: 'amanda.iniciante@example.test',
    },
    vehicleMake: 'Fiat',
    vehicleModel: 'Mobi',
    vehicleYear: 2023,
    vehiclePrice: 65000,
    vehiclePlate: 'DEM0A01',
    requestedAmount: 55000,
    status: 'link_sent',
  })

  // 2) Documento pede revisão manual — mostra dado extraído (baixa
  // confiança) lado a lado com o dado digitado pelo cliente no envio.
  {
    const { applicant, application } = await baseApplication({
      applicant: {
        fullName: 'Bruno Documentado',
        cpf: '39053344705',
        phone: '11999990002',
        email: 'bruno.documentado@example.test',
        birthDate: '1988-04-12',
        monthlyIncomeDeclared: 6000,
      },
      vehicleMake: 'VW',
      vehicleModel: 'Polo',
      vehicleYear: 2022,
      vehiclePrice: 92000,
      vehiclePlate: 'DEM0B02',
      requestedAmount: 85000,
      status: 'documents_review_required',
    })
    await insertConsents(db, applicant.id, application.id, ['data_processing', 'bureau_check'])
    await insertDocument(db, application.id, {
      type: 'rg',
      manualFields: { numeroDocumento: '32.111.222-3' },
      extraction: {
        fields: { nome: 'Bruno Documentado', cpf: '390.533.447-0X' },
        confidenceScore: 0.58,
        status: 'needs_review',
      },
    })
  }

  // 3) Documento limpo, aguardando o cliente decidir sobre Open Finance —
  // ainda não existe consentimento de Open Finance nesse ponto do fluxo.
  {
    const { applicant, application } = await baseApplication({
      applicant: {
        fullName: 'Carla Openfinance',
        cpf: '15350946056',
        phone: '11999990003',
        email: 'carla.openfinance@example.test',
        birthDate: '1990-09-30',
        monthlyIncomeDeclared: 12000,
      },
      vehicleMake: 'Toyota',
      vehicleModel: 'Yaris',
      vehicleYear: 2023,
      vehiclePrice: 98000,
      vehiclePlate: 'DEM0C03',
      requestedAmount: 80000,
      status: 'awaiting_openfinance_consent',
    })
    await insertConsents(db, applicant.id, application.id, [
      'data_processing',
      'bureau_check',
      'ai_narrative_share',
    ])
    await insertDocument(db, application.id, {
      type: 'cnh',
      extraction: {
        fields: { nome: 'Carla Openfinance', cpf: '153.509.460-56', dataNascimento: '1990-09-30' },
        confidenceScore: 0.97,
        status: 'auto_accepted',
      },
    })
  }

  // 4) Passaporte de comprador estrangeiro (Fase 8) — CPF extraído diverge
  // do declarado, força revisão manual por anti-fraude (regra real de
  // decide(), não um outcome escolhido a dedo).
  {
    const { applicant, application } = await baseApplication({
      applicant: {
        fullName: 'Diego Estrangeiro',
        cpf: '84893141059',
        phone: '11999990004',
        email: 'diego.estrangeiro@example.test',
        birthDate: '1985-02-14',
        monthlyIncomeDeclared: 9000,
      },
      vehicleMake: 'Jeep',
      vehicleModel: 'Compass',
      vehicleYear: 2022,
      vehiclePrice: 135000,
      vehiclePlate: 'DEM0D04',
      requestedAmount: 90000,
      status: 'manual_review',
    })
    await insertConsents(db, applicant.id, application.id, [
      'data_processing',
      'bureau_check',
      'ai_narrative_share',
      'openfinance_share',
    ])
    await insertDocument(db, application.id, {
      type: 'passaporte',
      manualFields: { numeroPassaporte: 'PT7654321', paisEmissor: 'Portugal' },
      extraction: {
        fields: {
          nome: 'Diego Estrangeiro',
          numeroPassaporte: 'PT7654321',
          nacionalidade: 'Portuguesa',
        },
        confidenceScore: 0.91,
        status: 'auto_accepted',
      },
    })
    const openfinanceIncomeEstimate = await insertOpenFinanceAuthorized(
      db,
      application.id,
      '84893141059',
    )
    await runChecksAndDecide(db, {
      applicationId: application.id,
      vehiclePlate: 'DEM0D04',
      declaredCpf: '84893141059',
      declaredFullName: 'Diego Estrangeiro',
      birthDate: '1985-02-14',
      requestedAmount: 90000,
      requestedTermMonths: 48,
      monthlyIncomeDeclared: 9000,
      bureauScenario: 'clean',
      vehicleScenario: 'clean',
      // Passaporte não tem CPF — o "extraído" aqui vem de um confronto com
      // outro documento (comprovante) que não bate, cenário real de
      // divergência que o anti-fraude pega.
      extractedCpf: '11111111111',
      extractedFullName: 'Diego Estrangeiro',
      openfinanceVerified: true,
      openfinanceIncomeEstimate,
    })
  }

  // 5) Caminho feliz completo — consulta FIPE REAL (BrasilAPI), Open
  // Finance autorizado, decisão aprovada calculada por decide(), oferta
  // gerada com a mesma fórmula do endpoint real.
  {
    const { applicant, application } = await baseApplication({
      applicant: {
        fullName: 'Elisa Aprovada',
        cpf: '32235608000',
        phone: '11999990005',
        email: 'elisa.aprovada@example.test',
        birthDate: '1992-11-03',
        monthlyIncomeDeclared: 12000,
      },
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      vehicleYear: 2023,
      vehiclePrice: 145000,
      vehiclePlate: 'DEM0E05',
      requestedAmount: 110000,
      status: 'offer_created',
    })
    await insertConsents(db, applicant.id, application.id, [
      'data_processing',
      'bureau_check',
      'ai_narrative_share',
      'openfinance_share',
    ])
    await insertDocument(db, application.id, {
      type: 'cnh',
      extraction: {
        fields: { nome: 'Elisa Aprovada', cpf: '322.356.080-00', dataNascimento: '1992-11-03' },
        confidenceScore: 0.98,
        status: 'auto_accepted',
      },
    })
    const fipe = await lookupFipeValue('Toyota', 'Corolla', 2023)
    const openfinanceIncomeEstimate = await insertOpenFinanceAuthorized(
      db,
      application.id,
      '32235608000',
    )
    const { decision } = await runChecksAndDecide(db, {
      applicationId: application.id,
      vehiclePlate: 'DEM0E05',
      declaredCpf: '32235608000',
      declaredFullName: 'Elisa Aprovada',
      birthDate: '1992-11-03',
      requestedAmount: 110000,
      requestedTermMonths: 48,
      monthlyIncomeDeclared: 12000,
      bureauScenario: 'clean',
      vehicleScenario: 'clean',
      extractedCpf: '32235608000',
      extractedFullName: 'Elisa Aprovada',
      fipeValue: fipe.fipeValue,
      fipeCode: fipe.fipeCode,
      fipeBrand: fipe.fipeBrand,
      fipeModel: fipe.fipeModel,
      fipeYear: fipe.fipeYear,
      openfinanceVerified: true,
      openfinanceIncomeEstimate,
    })
    if (decision.outcome === 'approved') {
      await db
        .update(creditDecisions)
        .set(NARRATIVES.approved)
        .where(eq(creditDecisions.id, decision.id))
      const amount = 110000
      await db.insert(loanOffers).values({
        applicationId: application.id,
        amount,
        termMonths: 48,
        interestRate: FIXED_MONTHLY_RATE,
        monthlyPayment: calculateMonthlyPayment(amount, FIXED_MONTHLY_RATE, 48),
        status: 'draft',
      })
    }
  }

  // 6) Negada por restrição veicular (roubo/furto/gravame simulado) — a
  // regra que nega antes de qualquer outra coisa em decide(). Cliente optou
  // por não autorizar bureau/parecer de IA nem Open Finance — mostra que a
  // esteira segue funcionando mesmo com consentimento parcial.
  {
    const { applicant, application } = await baseApplication({
      applicant: {
        fullName: 'Fábio Recusado',
        cpf: '52998224725',
        phone: '11999990006',
        email: 'fabio.recusado@example.test',
        birthDate: '1979-01-20',
        monthlyIncomeDeclared: 8000,
      },
      vehicleMake: 'Hyundai',
      vehicleModel: 'HB20',
      vehicleYear: 2021,
      vehiclePrice: 78000,
      vehiclePlate: 'DEM0F06',
      requestedAmount: 70000,
      status: 'denied',
    })
    await insertConsents(db, applicant.id, application.id, ['data_processing'])
    await insertOpenFinanceRejected(db, application.id)
    const { decision } = await runChecksAndDecide(db, {
      applicationId: application.id,
      vehiclePlate: 'DEM0F06',
      declaredCpf: '52998224725',
      declaredFullName: 'Fábio Recusado',
      birthDate: '1979-01-20',
      requestedAmount: 70000,
      requestedTermMonths: 48,
      monthlyIncomeDeclared: 8000,
      bureauScenario: 'clean',
      vehicleScenario: 'restricted',
      openfinanceVerified: false,
      openfinanceIncomeEstimate: null,
    })
    if (decision.outcome === 'denied') {
      await db
        .update(creditDecisions)
        .set(NARRATIVES.denied)
        .where(eq(creditDecisions.id, decision.id))
    }
  }

  // 7) Ciclo inteiro concluído — oferta aceita, o estado terminal "de
  // sucesso" da esteira (útil também pra ver a janela longa da retenção).
  {
    const { applicant, application } = await baseApplication({
      applicant: {
        fullName: 'Gabriela Concluída',
        cpf: '87676945008',
        phone: '11999990007',
        email: 'gabriela.concluida@example.test',
        birthDate: '1983-06-18',
        monthlyIncomeDeclared: 15000,
      },
      vehicleMake: 'Honda',
      vehicleModel: 'HR-V',
      vehicleYear: 2023,
      vehiclePrice: 155000,
      vehiclePlate: 'DEM0G07',
      requestedAmount: 120000,
      status: 'offer_accepted',
    })
    await insertConsents(db, applicant.id, application.id, [
      'data_processing',
      'bureau_check',
      'ai_narrative_share',
      'openfinance_share',
    ])
    await insertDocument(db, application.id, {
      type: 'rg',
      manualFields: { numeroDocumento: '18.222.333-4' },
      extraction: {
        fields: { nome: 'Gabriela Concluída', cpf: '876.769.450-08' },
        confidenceScore: 0.96,
        status: 'auto_accepted',
      },
    })
    const openfinanceIncomeEstimate = await insertOpenFinanceAuthorized(
      db,
      application.id,
      '87676945008',
    )
    const { decision } = await runChecksAndDecide(db, {
      applicationId: application.id,
      vehiclePlate: 'DEM0G07',
      declaredCpf: '87676945008',
      declaredFullName: 'Gabriela Concluída',
      birthDate: '1983-06-18',
      requestedAmount: 120000,
      requestedTermMonths: 48,
      monthlyIncomeDeclared: 15000,
      bureauScenario: 'clean',
      vehicleScenario: 'clean',
      extractedCpf: '87676945008',
      extractedFullName: 'Gabriela Concluída',
      openfinanceVerified: true,
      openfinanceIncomeEstimate,
    })
    if (decision.outcome === 'approved') {
      await db
        .update(creditDecisions)
        .set(NARRATIVES.approved)
        .where(eq(creditDecisions.id, decision.id))
    }
    const amount = 120000
    await db.insert(loanOffers).values({
      applicationId: application.id,
      amount,
      termMonths: 48,
      interestRate: FIXED_MONTHLY_RATE,
      monthlyPayment: calculateMonthlyPayment(amount, FIXED_MONTHLY_RATE, 48),
      status: 'accepted',
    })
  }

  console.log(
    'Seed ok — 7 propostas de exemplo criadas (link_sent, documents_review_required, ' +
      'awaiting_openfinance_consent, manual_review, offer_created, denied, offer_accepted).',
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
