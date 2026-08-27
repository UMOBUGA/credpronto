import type { Plugin } from 'vite'

/**
 * Espelha em dev as rewrites de `vercel.json`: `/portal/*` serve o bundle do
 * cliente, tudo mais (fora de `/api` e `/assets`) serve o bundle do dealer.
 * Sem isto, `npm run dev` só serviria o `index.html` que o Vite não tem neste
 * projeto MPA — visitar "/" daria 404 em vez de abrir o painel da loja.
 */
export function portalDevPlugin(): Plugin {
  return {
    name: 'credpronto:portal-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? ''
        // Módulos internos do próprio Vite (`/@react-refresh`, `/@vite/client`,
        // `/@vite/env`, `/@id/...`, `/@fs/...`) sempre começam com `/@` e não
        // têm ponto no nome — sem esta checagem eles caíam no fallback de SPA
        // abaixo e voltavam como `dealer.html`, quebrando o React Refresh e
        // deixando a tela em branco (o import de `/@react-refresh` falhava
        // silenciosamente por receber HTML em vez de JS).
        if (
          pathname.startsWith('/api/') ||
          pathname.startsWith('/assets/') ||
          pathname.startsWith('/@')
        ) {
          next()
          return
        }
        if (pathname === '/dealer.html' || pathname === '/client.html') {
          next()
          return
        }
        if (pathname.includes('.')) {
          next()
          return
        }

        req.url = pathname.startsWith('/portal/') ? '/client.html' : '/dealer.html'
        next()
      })
    },
  }
}
