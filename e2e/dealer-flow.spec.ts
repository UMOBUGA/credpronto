import { test, expect } from '@playwright/test'
import { createApplicationViaUi, loginAsDealer } from './helpers'

test.beforeEach(async ({ page }) => {
  await loginAsDealer(page)
})

test('cria uma proposta e navega até o detalhe sem ficar preso (regressão da Fase 7)', async ({
  page,
}) => {
  await createApplicationViaUi(page, {
    cpf: '39053344705',
    vehiclePlate: `NAV${Date.now()}`,
  })

  // A causa raiz da Fase 7: antes da correção, chegar aqui não deixava
  // nenhum jeito de voltar pra fila além do botão "voltar" do navegador.
  await expect(page.getByRole('link', { name: '← Voltar para propostas' })).toBeVisible()

  await page.getByRole('link', { name: '← Voltar para propostas' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Propostas' })).toBeVisible()
})

test('bloqueia o envio com CPF inválido, sem sair da tela (regressão do bug reportado)', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Nova proposta' }).click()
  await page.getByLabel('Nome completo').fill('Cliente Invalido')
  // Mesmo CPF de 10 dígitos que o usuário reportou na Fase 13.
  await page.getByLabel('CPF').fill('4532523534')
  await page.getByLabel('Telefone').fill('11999998888')
  await page.getByLabel('E-mail').fill('invalido.e2e@example.test')
  await page.getByLabel('Marca').fill('Fiat')
  await page.getByLabel('Modelo').fill('Uno')
  await page.getByLabel('Ano').fill('2022')
  await page.getByLabel('Preço do veículo').fill('45000')
  await page.getByLabel('Placa').fill('INV0001')
  await page.getByLabel('Valor solicitado').fill('30000')
  await page.getByLabel('Prazo (meses)').fill('36')
  await page.getByRole('button', { name: 'Criar e gerar link' }).click()

  await expect(
    page.getByText('CPF inválido — confira os 11 dígitos e o dígito verificador.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Nova proposta' })).toBeVisible()
})

test('detalhe de uma proposta recém-criada carrega todas as seções sem erro de console', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))

  await createApplicationViaUi(page, {
    cpf: '15350946056',
    vehiclePlate: `SEC${Date.now()}`,
  })

  await expect(page.getByRole('heading', { name: 'Comprador' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Link do cliente' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Consentimentos' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Documentos' })).toBeVisible()
  // Fase 16: a própria criação da proposta já dispara essa notificação.
  await expect(page.getByText('Link do portal enviado ao cliente')).toBeVisible()

  expect(consoleErrors).toEqual([])
})
