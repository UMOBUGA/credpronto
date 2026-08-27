import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import App from './App'

const APPLICATION_ID = '00000000-0000-0000-0000-000000000000'

function buildApplicationDetail(status: string) {
  return {
    id: APPLICATION_ID,
    applicantId: 'applicant-1',
    dealerUserId: '1',
    vehicleMake: 'Fiat',
    vehicleModel: 'Argo',
    vehicleYear: 2022,
    vehiclePrice: 80000,
    vehiclePlate: 'ABC1D23',
    downPayment: 10000,
    requestedAmount: 70000,
    requestedTermMonths: 48,
    status,
    clientPortalToken: 'token123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    applicant: {
      id: 'applicant-1',
      fullName: 'Fulano de Teste',
      cpfMasked: '•••.•••.•••-••',
      phone: '11999990000',
      email: 'fulano@example.test',
      birthDate: null,
      address: null,
      hasMonthlyIncomeDeclared: false,
    },
    documents: [],
    latestBureauCheck: null,
    latestVehicleCheck: null,
    latestAntifraudCheck: null,
    latestOpenfinanceConsent: null,
    latestDecision: null,
    offers: [],
    consents: [],
    notifications: [],
  }
}

describe('App (dealer)', () => {
  it('mostra o login quando não há sessão', async () => {
    renderWithQuery(<App />)
    expect(await screen.findByText('Painel da loja')).toBeInTheDocument()
  })

  it('mostra a lista de propostas quando autenticado', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
    )
    renderWithQuery(<App />)

    expect(await screen.findByText('Dealer Teste')).toBeInTheDocument()
    expect(await screen.findByText('Nenhuma proposta ainda.')).toBeInTheDocument()
  })

  it('mostra o cabeçalho persistente e o link de volta na tela de nova proposta', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
    )
    renderWithQuery(<App />, { route: '/nova' })

    expect(await screen.findByText('credpronto')).toBeInTheDocument()
    expect(screen.getByText('← Voltar para propostas')).toBeInTheDocument()
  })

  it('mostra o cabeçalho persistente no detalhe de uma proposta — nenhuma rota fica sem saída', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
      http.get('/api/applications/:id', () =>
        HttpResponse.json({
          id: '00000000-0000-0000-0000-000000000000',
          vehicleMake: 'Fiat',
          vehicleModel: 'Argo',
          vehicleYear: 2022,
          vehiclePlate: 'ABC1D23',
          status: 'link_sent',
          clientPortalToken: 'token123',
          applicant: {
            id: 'applicant-1',
            fullName: 'Fulano de Teste',
            cpfMasked: '•••.•••.•••-••',
            phone: '11999990000',
            email: 'fulano@example.test',
            birthDate: null,
            address: null,
            hasMonthlyIncomeDeclared: false,
          },
          documents: [],
          latestBureauCheck: null,
          latestVehicleCheck: null,
          latestAntifraudCheck: null,
          latestOpenfinanceConsent: null,
          latestDecision: null,
          offers: [],
          consents: [],
          notifications: [],
        }),
      ),
      http.get('/api/applications/:id/audit-log', () => HttpResponse.json([])),
    )
    renderWithQuery(<App />, { route: '/propostas/00000000-0000-0000-0000-000000000000' })

    expect(await screen.findByText('credpronto')).toBeInTheDocument()
    expect(await screen.findByText('← Voltar para propostas')).toBeInTheDocument()
  })

  it('mostra o formulário de edição em status editável e salva as alterações (Fase 14)', async () => {
    let patchedBody: unknown = null
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
      http.get('/api/applications/:id', () => HttpResponse.json(buildApplicationDetail('draft'))),
      http.get('/api/applications/:id/audit-log', () => HttpResponse.json([])),
      http.patch('/api/applications/:id', async ({ request }) => {
        patchedBody = await request.json()
        return HttpResponse.json({ ...buildApplicationDetail('draft'), ...(patchedBody as object) })
      }),
    )
    renderWithQuery(<App />, { route: `/propostas/${APPLICATION_ID}` })

    expect(await screen.findByText('Editar proposta')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => {
      expect(patchedBody).not.toBeNull()
    })
    expect(await screen.findByText('Alterações salvas.')).toBeInTheDocument()
  })

  it('não mostra o formulário de edição fora dos status editáveis (Fase 14)', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
      http.get('/api/applications/:id', () =>
        HttpResponse.json(buildApplicationDetail('manual_review')),
      ),
      http.get('/api/applications/:id/audit-log', () => HttpResponse.json([])),
    )
    renderWithQuery(<App />, { route: `/propostas/${APPLICATION_ID}` })

    expect(await screen.findByText('credpronto')).toBeInTheDocument()
    expect(screen.queryByText('Editar proposta')).not.toBeInTheDocument()
  })

  it('mostra as notificações disparadas para a proposta (Fase 16)', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
      http.get('/api/applications/:id', () =>
        HttpResponse.json({
          ...buildApplicationDetail('offer_created'),
          notifications: [
            {
              id: 'n1',
              template: 'offer_created',
              status: 'sent',
              sentAt: '2026-08-27T12:00:00.000Z',
            },
            {
              id: 'n2',
              template: 'link_sent',
              status: 'failed',
              sentAt: '2026-08-20T12:00:00.000Z',
            },
          ],
        }),
      ),
      http.get('/api/applications/:id/audit-log', () => HttpResponse.json([])),
    )
    renderWithQuery(<App />, { route: `/propostas/${APPLICATION_ID}` })

    expect(
      await screen.findByText('Oferta de financiamento gerada — 27/08/2026'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Link do portal enviado ao cliente/)).toBeInTheDocument()
    expect(screen.getByText(/\(falhou\)/)).toBeInTheDocument()
  })

  it('mostra mensagem de vazio quando nenhuma notificação foi disparada ainda (Fase 16)', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
      http.get('/api/applications/:id', () => HttpResponse.json(buildApplicationDetail('draft'))),
      http.get('/api/applications/:id/audit-log', () => HttpResponse.json([])),
    )
    renderWithQuery(<App />, { route: `/propostas/${APPLICATION_ID}` })

    expect(await screen.findByText('Nenhuma notificação disparada ainda.')).toBeInTheDocument()
  })

  it('mostra o link "Usuários" no menu só pra admin (Fase 17)', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'admin' },
        }),
      ),
    )
    renderWithQuery(<App />)

    expect(await screen.findByRole('link', { name: 'Usuários' })).toBeInTheDocument()
  })

  it('esconde o link "Usuários" do menu pra manager/analyst (Fase 17)', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'analyst' },
        }),
      ),
    )
    renderWithQuery(<App />)

    await screen.findByText('Dealer Teste')
    expect(screen.queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument()
  })

  it('redireciona quem não é admin ao navegar direto pra /usuarios (Fase 17)', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({
          user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role: 'analyst' },
        }),
      ),
      // A página monta (e dispara essa busca) antes do guard de role redirecionar —
      // só evita o aviso de "unhandled request" do MSW, a resposta em si é descartada.
      http.get('/api/dealers', () => HttpResponse.json([])),
    )
    renderWithQuery(<App />, { route: '/usuarios' })

    expect(await screen.findByText('Nenhuma proposta ainda.')).toBeInTheDocument()
  })
})
