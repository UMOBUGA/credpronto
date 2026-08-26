import type { Plugin, ViteDevServer } from 'vite'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Em produção o Vercel serve `/api/*` como funções serverless a partir dos
 * arquivos em `api/` por convenção de arquivo. Em dev, `vite` sozinho não
 * sabe nada sobre essa pasta; este plugin fecha essa lacuna montando os
 * mesmos handlers como middleware do dev server, via `ssrLoadModule`.
 *
 * Diferente do painel-do-ar (3 rotas fixas), credpronto tem dezenas de rotas
 * com múltiplos segmentos dinâmicos — então aqui a tabela é derivada
 * escaneando `api/**` (exceto `_lib` e `*.test.ts`) uma vez na inicialização
 * do dev server, traduzindo `[param]` em grupos nomeados de regex. Ainda não
 * é um router genérico: só resolve o formato de arquivo que o próprio Vercel
 * já usa, nada além disso.
 */
interface Route {
  pattern: RegExp
  file: string
}

function segmentToRegex(segment: string): string {
  const match = /^\[(\w+)\]$/.exec(segment)
  if (!match) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const [, name] = match
  return `(?<${name}>[^/]+)`
}

async function collectTsFiles(dir: string, root: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full, root)))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }

  return files
}

async function buildRoutes(): Promise<Route[]> {
  const apiRoot = path.resolve('api')
  const files = await collectTsFiles(apiRoot, apiRoot)

  return files.map((file) => {
    const relative = file.slice(0, -'.ts'.length)
    // Convenção do Vercel: `foo/index.ts` responde em `/foo`, não `/foo/index`.
    const rawSegments = relative.split('/')
    const lastIndex = rawSegments.length - 1
    if (rawSegments[lastIndex] === 'index') rawSegments.pop()
    const segments = rawSegments.map(segmentToRegex)
    const pattern = new RegExp(`^/api${segments.length ? '/' + segments.join('/') : ''}/?$`)
    return { pattern, file: `/api/${file}` }
  })
}

export function apiDevPlugin(): Plugin {
  let routes: Route[] = []

  return {
    name: 'credpronto:api-dev',
    async configureServer(server: ViteDevServer) {
      routes = await buildRoutes()

      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? ''
        const route = routes.find((r) => r.pattern.test(pathname))
        if (!route) {
          next()
          return
        }

        try {
          const mod = await server.ssrLoadModule(route.file)
          await mod.default(req, res)
        } catch (error) {
          next(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
  }
}
