import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import App from './App'

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
        }),
      ),
      http.get('/api/applications/:id/audit-log', () => HttpResponse.json([])),
    )
    renderWithQuery(<App />, { route: '/propostas/00000000-0000-0000-0000-000000000000' })

    expect(await screen.findByText('credpronto')).toBeInTheDocument()
    expect(await screen.findByText('← Voltar para propostas')).toBeInTheDocument()
  })
})
