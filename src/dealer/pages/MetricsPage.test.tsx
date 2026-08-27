import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import App from '../App'

function mockSession(role: 'admin' | 'manager' | 'analyst') {
  server.use(
    http.get('/api/auth/session', () =>
      HttpResponse.json({
        user: { id: '1', name: 'Dealer Teste', email: 'd@example.test', role },
      }),
    ),
  )
}

describe('MetricsPage (Fase 18)', () => {
  it('mostra o link "Métricas" no menu pra qualquer papel', async () => {
    mockSession('analyst')
    renderWithQuery(<App />)
    expect(await screen.findByRole('link', { name: 'Métricas' })).toBeInTheDocument()
  })

  it('renderiza os cards e as barras com os números da API', async () => {
    mockSession('admin')
    server.use(
      http.get('/api/metrics/summary', () =>
        HttpResponse.json({
          statusCounts: { total: 12, reviewing: 2, approved: 3, closed: 4 },
          totalDecisions: 5,
          approvalRate: 0.6,
          outcomeBreakdown: { approved: 3, denied: 1, manual_review: 1 },
          averageDecisionHours: 2.5,
          scoreDistribution: [
            { label: '300–449', count: 1 },
            { label: '450–599', count: 1 },
            { label: '600–749', count: 0 },
            { label: '750–900', count: 3 },
          ],
        }),
      ),
    )
    renderWithQuery(<App />, { route: '/metricas' })

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('2.5h')).toBeInTheDocument()
    expect(screen.getByText('Aprovadas')).toBeInTheDocument()
    expect(screen.getByText('750–900')).toBeInTheDocument()
  })

  it('mostra mensagem de vazio quando não há nenhuma decisão', async () => {
    mockSession('admin')
    server.use(
      http.get('/api/metrics/summary', () =>
        HttpResponse.json({
          statusCounts: { total: 0, reviewing: 0, approved: 0, closed: 0 },
          totalDecisions: 0,
          approvalRate: null,
          outcomeBreakdown: { approved: 0, denied: 0, manual_review: 0 },
          averageDecisionHours: null,
          scoreDistribution: [
            { label: '300–449', count: 0 },
            { label: '450–599', count: 0 },
            { label: '600–749', count: 0 },
            { label: '750–900', count: 0 },
          ],
        }),
      ),
    )
    renderWithQuery(<App />, { route: '/metricas' })

    expect(await screen.findByText('Nenhuma decisão registrada ainda.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum score registrado ainda.')).toBeInTheDocument()
  })
})
