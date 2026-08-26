import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import LoginPage from './LoginPage'

describe('LoginPage', () => {
  it('mostra erro em credenciais inválidas', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'invalid_credentials' }, { status: 401 }),
      ),
    )
    renderWithQuery(<LoginPage />)

    await userEvent.type(screen.getByLabelText('E-mail'), 'dealer@example.test')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-errada')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('E-mail ou senha inválidos.')).toBeInTheDocument()
  })

  it('loga com sucesso', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ id: '1', name: 'Dealer', email: 'dealer@example.test', role: 'admin' }),
      ),
    )
    renderWithQuery(<LoginPage />)

    await userEvent.type(screen.getByLabelText('E-mail'), 'dealer@example.test')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-certa')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => {
      expect(screen.queryByText(/Não foi possível/)).not.toBeInTheDocument()
    })
  })
})
