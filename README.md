# credpronto

Esteira de análise de crédito para lojas de veículos: a loja cadastra uma proposta, o comprador
recebe um link próprio para completar seus dados e enviar documentos, o sistema roda uma
checagem de bureau simulada e um motor de decisão determinístico, e — se aprovado — gera uma
oferta de financiamento.

> **Projeto de portfólio.** Bureau de crédito (Serasa/SPC), restrição veicular e Open Finance
> Brasil são simulados — acesso real ao primeiro exige CNPJ e contrato comercial; ao segundo, não
> existe API pública no Brasil; ao terceiro, autorização do Banco Central (nem contrato resolve
> pra uma pessoa física). Todo dado usado em desenvolvimento e nas demos é sintético; nunca use
> CPF, nome ou documento reais neste projeto.

## Duas frentes

- **Painel da loja** (`dealer.html`, `src/dealer/`) — autenticado, para o vendedor criar
  propostas, acompanhar a esteira e revisar casos.
- **Portal do cliente** (`client.html`, `src/client/`) — link único por proposta
  (`/portal/:token`), sem login, para o comprador preencher dados e enviar documentos.

## Rodando localmente

```bash
npm install
npm run db:seed    # cria dealer@credpronto.dev / credpronto123 + 4 propostas de exemplo
npm run dev
```

Sem nenhuma variável de ambiente definida, o backend roda contra um Postgres embutido (PGlite)
local — zero configuração. Acesse `http://localhost:5173/` para o painel da loja.

### Roteiro de demonstração

Depois do `npm run db:seed`, logue com `dealer@credpronto.dev` / `credpronto123` e a fila já vem
com 4 propostas em estados diferentes:

1. **Proposta em `manual_review`** — abra o detalhe: bureau/veículo/antifraude já rodaram, um
   sinal de antifraude forçou revisão humana. Clique em "Aprovar manualmente" ou "Negar
   manualmente" pra ver `resolve.ts` gerar uma nova linha em `credit_decisions` e (com
   `ANTHROPIC_API_KEY` configurada) um parecer de IA de verdade.
2. **Proposta em `offer_created`** — CPF e renda aparecem mascarados por padrão; clique em
   "Revelar" (usuário seed é `admin`) e note a nova linha `pii.revealed` na "Trilha de auditoria"
   no fim da página, distinta das linhas `pii.decrypted` rotineiras.
3. **Proposta em `denied`** — bureau simulado com restrição ativa; a "Trilha de auditoria" mostra
   a sequência completa de decrypts que a tela de detalhe disparou.
4. **Proposta em `link_sent`** — copie o link do portal do cliente (`/portal/:token` na própria
   URL) e complete o fluxo do zero: dados pessoais (com os 3 checkboxes de consentimento
   granular), upload de documento — inclui a opção "Passaporte (estrangeiros)" com campo de
   número/país digitados junto com a foto (extração por IA se `ANTHROPIC_API_KEY` estiver
   configurada, senão cai graciosamente em `failed` com retry manual) —, Open Finance simulado,
   checagens, decisão, oferta. Um indicador de progresso no topo do portal mostra em qual desses
   passos o cliente está.
5. **"Nova proposta"** — antes de criar, digite marca/modelo/ano e clique em "Consultar valor
   FIPE" pra ver o valor de mercado real (BrasilAPI) já na hora de montar a proposta.
6. **Crons manualmente**: `curl -X POST http://localhost:5173/api/cron/retention-sweep?dryRun=true`
   mostra o que seria anonimizado sem escrever nada; sem `dryRun`, anonimiza de verdade quem já
   passou da janela de retenção (nenhuma das 4 propostas de exemplo qualifica — são recém-criadas).

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
- ✅ Fase 5 — Open Finance Brasil simulado (integração real exige autorização do Bacen — ver CLAUDE.md)
- ✅ Fase 6 — hardening de LGPD (consentimento granular, mascaramento/revelação de PII, trilha de
  auditoria visível, retenção com anonimização, rate limiting) e polimento
- ✅ Fase 7 — layout compartilhado do dealer (corrige navegação que ficava sem saída)
- ✅ Fase 8 — upload de documento com dado manual + passaporte para comprador estrangeiro
- ✅ Fase 9 — consulta do valor FIPE já na criação da proposta
- ✅ Fase 10 — repaginação visual completa (tipografia, paleta, componentes)
- ✅ Fase 11 — revalidação geral ponta a ponta (ver CLAUDE.md para os achados registrados)
