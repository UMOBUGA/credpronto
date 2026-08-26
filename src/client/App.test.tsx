import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import App from './App'

describe('App (portal do cliente)', () => {
  it('mostra link inválido sem token na URL', () => {
    window.history.pushState({}, '', '/')
    renderWithQuery(<App />)
    expect(screen.getByText('Link inválido.')).toBeInTheDocument()
  })

  it('mostra o formulário de dados pessoais quando ainda não enviados', async () => {
    window.history.pushState({}, '', '/portal/abc123')
    server.use(
      http.get('/api/client/abc123', () =>
        HttpResponse.json({
          status: 'link_sent',
          vehicle: { make: 'Fiat', model: 'Argo', year: 2022, price: 80000 },
          requestedAmount: 70000,
          requestedTermMonths: 48,
          hasSubmittedDetails: false,
          documents: [],
        }),
      ),
    )
    renderWithQuery(<App />)

    expect(await screen.findByText('Complete seus dados')).toBeInTheDocument()
  })
})
