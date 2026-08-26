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
})
