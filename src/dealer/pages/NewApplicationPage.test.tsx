import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/mocks/server'
import { renderWithQuery } from '@/test/renderApp'
import NewApplicationPage from './NewApplicationPage'

async function fillRequiredFields(cpf: string) {
  await userEvent.type(screen.getByLabelText('Nome completo'), 'Fulano de Teste')
  await userEvent.type(screen.getByLabelText('CPF'), cpf)
  await userEvent.type(screen.getByLabelText('Telefone'), '11999990000')
  await userEvent.type(screen.getByLabelText('E-mail'), 'fulano@example.test')
  await userEvent.type(screen.getByLabelText('Marca'), 'Fiat')
  await userEvent.type(screen.getByLabelText('Modelo'), 'Argo')
  await userEvent.clear(screen.getByLabelText('Ano'))
  await userEvent.type(screen.getByLabelText('Ano'), '2022')
  await userEvent.clear(screen.getByLabelText('Preço do veículo'))
  await userEvent.type(screen.getByLabelText('Preço do veículo'), '60000')
  await userEvent.type(screen.getByLabelText('Placa'), 'ABC1D23')
  await userEvent.clear(screen.getByLabelText('Valor solicitado'))
  await userEvent.type(screen.getByLabelText('Valor solicitado'), '50000')
}

describe('NewApplicationPage — validação de CPF (Fase 13)', () => {
  it('bloqueia o envio com CPF inválido, sem chamar a API', async () => {
    let createCalled = false
    server.use(
      http.post('/api/applications', () => {
        createCalled = true
        return HttpResponse.json({ id: '1', portalPath: '/portal/x' }, { status: 201 })
      }),
    )
    renderWithQuery(<NewApplicationPage />)

    // Mesmo CPF de 10 dígitos que o usuário reportou.
    await fillRequiredFields('4532523534')
    await userEvent.click(screen.getByRole('button', { name: 'Criar e gerar link' }))

    expect(
      await screen.findByText('CPF inválido — confira os 11 dígitos e o dígito verificador.'),
    ).toBeInTheDocument()
    expect(createCalled).toBe(false)
  })

  it('permite o envio com CPF válido', async () => {
    server.use(
      http.post('/api/applications', () =>
        HttpResponse.json({ id: '1', portalPath: '/portal/x' }, { status: 201 }),
      ),
    )
    renderWithQuery(<NewApplicationPage />)

    await fillRequiredFields('39053344705')
    await userEvent.click(screen.getByRole('button', { name: 'Criar e gerar link' }))

    await waitFor(() => {
      expect(screen.queryByText(/CPF inválido/)).not.toBeInTheDocument()
    })
  })
})
