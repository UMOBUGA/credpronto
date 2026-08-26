# credpronto

Esteira de análise de crédito para lojas de veículos: a loja cadastra uma proposta, o comprador
recebe um link próprio para completar seus dados e enviar documentos, o sistema roda uma
checagem de bureau simulada e um motor de decisão determinístico, e — se aprovado — gera uma
oferta de financiamento.

> **Projeto de portfólio.** O bureau de crédito (Serasa/SPC) é simulado — acesso real exige CNPJ
> e contrato comercial. Todo dado usado em desenvolvimento e nas demos é sintético; nunca use
> CPF, nome ou documento reais neste projeto.

## Duas frentes

- **Painel da loja** (`dealer.html`, `src/dealer/`) — autenticado, para o vendedor criar
  propostas, acompanhar a esteira e revisar casos.
- **Portal do cliente** (`client.html`, `src/client/`) — link único por proposta
  (`/portal/:token`), sem login, para o comprador preencher dados e enviar documentos.

## Rodando localmente

```bash
npm install
npm run db:seed    # cria o usuário dealer@credpronto.dev / credpronto123
npm run dev
```

Sem nenhuma variável de ambiente definida, o backend roda contra um Postgres embutido (PGlite)
local — zero configuração. Acesse `http://localhost:5173/` para o painel da loja.

## Comandos

```bash
npm run dev              # servidor de dev (Vite + middleware que serve /api/*)
npm run build             # tsc -b && vite build → dist/
npm run typecheck         # tsc -b --noEmit
npm run lint               # eslint .
npm run format              # prettier --write .
npm test                    # vitest run
npm run test:coverage       # vitest run --coverage
npm run db:generate          # gera migração SQL a partir de api/_lib/schema.ts
npm run db:migrate            # aplica migrações (só necessário com DATABASE_URL real)
npm run db:seed                # cria o usuário dealer de desenvolvimento
```

## Arquitetura

Ver [CLAUDE.md](CLAUDE.md) para o racional completo de arquitetura, convenções herdadas do
[painel-do-ar](../painel-do-ar) e as limitações conhecidas e deliberadas do projeto.

## Estado do projeto

- ✅ Fase 0 — fundação (scaffolding, CI, dois portais)
- ✅ Fase 1 — esteira core com bureau e decisão simulados, sem IA e sem Open Finance
- ✅ Fase 2 — extração de documento via IA (Claude), com revisão manual do dealer
- ✅ Fase 3 — anti-fraude e consulta veicular (FIPE real via BrasilAPI + restrição simulada)
- ✅ Fase 4 — parecer de risco via IA (Claude), versão técnica e versão para o cliente
- ⬜ Fase 5 — integração real com o sandbox do Open Finance Brasil
- ⬜ Fase 6 — hardening de LGPD (mascaramento, retenção, trilha de auditoria completa) e polimento
