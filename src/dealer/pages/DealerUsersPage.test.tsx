import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import App from '../App'

const ADMIN_SESSION = {
  user: { id: 'admin-1', name: 'Admin Teste', email: 'admin@example.test', role: 'admin' },
}

function mockAdminSessionAndUsers(users: unknown[]) {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(ADMIN_SESSION)),
    http.get('/api/dealers', () => HttpResponse.json(users)),
  )
}

describe('DealerUsersPage (Fase 17)', () => {
  it('lista os usuários e cria um novo com sucesso', async () => {
    let createdBody: unknown = null
    mockAdminSessionAndUsers([
      {
        id: 'admin-1',
        name: 'Admin Teste',
        email: 'admin@example.test',
        role: 'admin',
        createdAt: new Date().toISOString(),
        disabledAt: null,
      },
    ])
    server.use(
      http.post('/api/dealers', async ({ request }) => {
        createdBody = await request.json()
        const { name, email, role } = createdBody as { name: string; email: string; role: string }
        return HttpResponse.json({ id: 'new-1', name, email, role }, { status: 201 })
      }),
    )
    renderWithQuery(<App />, { route: '/usuarios' })

    expect(await screen.findByText('Usuários da loja')).toBeInTheDocument()
    expect(await screen.findByText('admin@example.test')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Nome completo'), 'Nova Analista')
    await userEvent.type(screen.getByLabelText('E-mail'), 'nova@example.test')
    await userEvent.type(screen.getByLabelText('Senha inicial'), 'senha12345')
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))

    await waitFor(() => expect(createdBody).not.toBeNull())
    expect(createdBody).toMatchObject({
      name: 'Nova Analista',
      email: 'nova@example.test',
      password: 'senha12345',
      role: 'analyst',
    })
  })

  it('mostra mensagem específica quando o e-mail já está em uso', async () => {
    mockAdminSessionAndUsers([])
    server.use(
      http.post('/api/dealers', () =>
        HttpResponse.json({ error: 'email_in_use' }, { status: 409 }),
      ),
    )
    renderWithQuery(<App />, { route: '/usuarios' })

    await screen.findByText('Usuários da loja')
    await userEvent.type(screen.getByLabelText('Nome completo'), 'Duplicado')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ja-existe@example.test')
    await userEvent.type(screen.getByLabelText('Senha inicial'), 'senha12345')
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }))

    expect(await screen.findByText('Já existe um usuário com esse e-mail.')).toBeInTheDocument()
  })

  it('desabilita o botão de desativar a própria conta', async () => {
    mockAdminSessionAndUsers([
      {
        id: 'admin-1',
        name: 'Admin Teste',
        email: 'admin@example.test',
        role: 'admin',
        createdAt: new Date().toISOString(),
        disabledAt: null,
      },
      {
        id: 'other-1',
        name: 'Outro Usuário',
        email: 'outro@example.test',
        role: 'analyst',
        createdAt: new Date().toISOString(),
        disabledAt: null,
      },
    ])
    renderWithQuery(<App />, { route: '/usuarios' })

    await screen.findByText('outro@example.test')
    const rows = screen.getAllByRole('row')
    const selfRow = rows.find((row) => row.textContent?.includes('admin@example.test'))
    const otherRow = rows.find((row) => row.textContent?.includes('outro@example.test'))

    expect(selfRow?.querySelector('button')).toBeDisabled()
    expect(otherRow?.querySelector('button')).not.toBeDisabled()
  })
})
