import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './src/test/mocks/server'

/**
 * jsdom cria AbortController/AbortSignal no seu próprio realm de VM. O fetch
 * nativo do Node (Undici) faz uma checagem WebIDL que rejeita um AbortSignal
 * de outro realm mesmo passando em "instanceof" — o pedido nem chega a sair
 * ("Expected signal to be an instance of AbortSignal"). Isso só acontece
 * neste ambiente de teste; no navegador real o AbortSignal já nasce no mesmo
 * realm do fetch. Envolve o fetch para nunca repassar o signal estrangeiro
 * adiante, implementando o cancelamento manualmente. Mesmo problema, mesma
 * correção do painel-do-ar (`vitest.setup.ts` de lá) — reaproveitado aqui
 * porque este projeto também usa TanStack Query + fetch.
 *
 * Precisa envolver depois de `server.listen()`: o MSW substitui
 * `globalThis.fetch` inteiro ao ativar a interceptação, então envolver antes
 * seria descartado.
 */
function guardForeignRealmAbortSignal() {
  const patchedFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const { signal, ...rest } = init ?? {}
    if (!signal) return patchedFetch(input, init)
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))

    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      patchedFetch(input, rest)
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort))
    })
  }) as typeof fetch
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  guardForeignRealmAbortSignal()
})
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
