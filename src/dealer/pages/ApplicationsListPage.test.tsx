import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import ApplicationsListPage from './ApplicationsListPage'

function buildItem(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    applicantId: 'applicant-1',
    dealerUserId: 'dealer-1',
    vehicleMake: 'Fiat',
    vehicleModel: 'Argo',
    vehicleYear: 2022,
    vehiclePrice: 80000,
    vehiclePlate: 'ABC1D23',
    downPayment: 10000,
    requestedAmount: 70000,
    requestedTermMonths: 48,
    status: 'draft',
    clientPortalToken: 'token',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ApplicationsListPage — busca e filtro (Fase 15)', () => {
  it('reseta pra página 1 ao digitar uma busca, mesmo vindo da página 2', async () => {
    const requestedUrls: string[] = []
    server.use(
      http.get('/api/applications', ({ request }) => {
        const url = new URL(request.url)
        requestedUrls.push(url.search)
        return HttpResponse.json({
          items: [buildItem('1')],
          page: Number(url.searchParams.get('page')) || 1,
          pageSize: 25,
          hasMore: true,
          stats: { total: 30, reviewing: 0, approved: 0, closed: 0 },
        })
      }),
    )
    renderWithQuery(<ApplicationsListPage />)

    await screen.findByText('Fiat Argo (2022)')
    await userEvent.click(screen.getByRole('button', { name: 'Próxima →' }))
    await waitFor(() => expect(screen.getByText('Página 2')).toBeInTheDocument())

    await userEvent.type(screen.getByLabelText('Buscar propostas'), 'corolla')

    await waitFor(() => expect(screen.getByText('Página 1')).toBeInTheDocument())
    const last = requestedUrls[requestedUrls.length - 1]!
    const lastParams = new URLSearchParams(last)
    expect(lastParams.get('page')).toBe('1')
    expect(lastParams.get('q')).toBe('corolla')
  })

  it('filtra por status via o seletor e mostra mensagem específica quando nada casa', async () => {
    server.use(
      http.get('/api/applications', ({ request }) => {
        const url = new URL(request.url)
        const status = url.searchParams.get('status')
        return HttpResponse.json({
          items: status === 'denied' ? [] : [buildItem('1')],
          page: 1,
          pageSize: 25,
          hasMore: false,
          stats: { total: 5, reviewing: 0, approved: 0, closed: 1 },
        })
      }),
    )
    renderWithQuery(<ApplicationsListPage />)

    await screen.findByText('Fiat Argo (2022)')
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por status'), 'denied')

    expect(
      await screen.findByText('Nenhuma proposta encontrada com esse filtro.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Criar a primeira proposta')).not.toBeInTheDocument()
  })
})
