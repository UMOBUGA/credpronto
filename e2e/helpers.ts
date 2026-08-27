import type { Page } from '@playwright/test'

export const DEALER_EMAIL = 'dealer@credpronto.dev'
export const DEALER_PASSWORD = 'credpronto123'

export async function loginAsDealer(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(DEALER_EMAIL)
  await page.getByLabel('Senha').fill(DEALER_PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByRole('heading', { name: 'Propostas' }).waitFor()
}

interface NewApplicationOverrides {
  fullName?: string
  /** CPF com checksum válido — o formulário valida no navegador antes de enviar. */
  cpf?: string
  email?: string
  vehiclePlate?: string
}

/**
 * Preenche e envia o formulário de nova proposta pela UI de verdade (não
 * via chamada direta à API) — é o próprio caminho que exercita a
 * navegação real que a Fase 7 corrigiu. `cpf` e `vehiclePlate` têm
 * default, mas aceitam override pra testes que precisam de valores únicos
 * (ex.: não colidir com o dedupe por CPF de outro teste).
 */
export async function createApplicationViaUi(
  page: Page,
  overrides: NewApplicationOverrides = {},
): Promise<void> {
  await page.getByRole('link', { name: 'Nova proposta' }).click()
  await page.getByLabel('Nome completo').fill(overrides.fullName ?? 'Cliente E2E')
  await page.getByLabel('CPF').fill(overrides.cpf ?? '39053344705')
  await page.getByLabel('Telefone').fill('11999998888')
  await page.getByLabel('E-mail').fill(overrides.email ?? `cliente.e2e.${Date.now()}@example.test`)
  await page.getByLabel('Marca').fill('Fiat')
  await page.getByLabel('Modelo').fill('Uno')
  await page.getByLabel('Ano').fill('2022')
  await page.getByLabel('Preço do veículo').fill('45000')
  await page.getByLabel('Placa').fill(overrides.vehiclePlate ?? `E2E${Date.now()}`)
  await page.getByLabel('Valor solicitado').fill('30000')
  await page.getByLabel('Prazo (meses)').fill('36')
  await page.getByRole('button', { name: 'Criar e gerar link' }).click()
  await page.waitForURL(/\/propostas\//)
}
