# CLAUDE.md

Guia para o Claude Code (claude.ai/code) ao trabalhar neste repositório.

## O projeto

credpronto é uma esteira de análise de crédito para lojas de veículos: a loja cria uma proposta,
o comprador recebe um link próprio para preencher dados e enviar documentos, o sistema roda uma
checagem de bureau (simulada) e um motor de decisão determinístico, e — se aprovado — gera uma
oferta de financiamento. Projeto de portfólio, não um produto real; ver limitações abaixo.

Arquitetura irmã da do [painel-do-ar](../painel-do-ar): React 18 + TypeScript + Vite no
frontend, Vercel Functions + Postgres/Drizzle no backend (`api/`), mesma convenção de handler
Node puro e mesma estratégia de dev sem configuração (PGlite embutido sem `DATABASE_URL`). São
repositórios completamente separados — nunca importe de um para o outro.

## Duas frentes (dois HTMLs, um projeto Vite)

`dealer.html` (`src/dealer/`) é o painel autenticado da loja. `client.html` (`src/client/`) é o
portal do comprador, autenticado só por um token de alta entropia na URL
(`/portal/:token`), sem sessão nem senha. São dois bundles JS separados de propósito — o
navegador do comprador nunca deveria baixar código ou dados dealer-only. `vite.config.ts`
declara os dois como `build.rollupOptions.input`; `vite.portal-plugin.ts` espelha em dev as
mesmas rewrites que `vercel.json` faz em produção (`/portal/*` → `client.html`, resto →
`dealer.html`).

## Backend (`api/`)

Mesma convenção de arquivo do painel-do-ar: cada `.ts` em `api/` é uma função serverless,
`api/_lib/` é código compartilhado (prefixo `_` = Vercel ignora como rota). Diferente de lá,
`vite.api-plugin.ts` aqui **escaneia** `api/**/*.ts` em vez de usar uma tabela fixa — são
dezenas de rotas com segmentos dinâmicos (`[id]`, `[token]`), não as 3 rotas fixas do painel do
ar. Segue a convenção do próprio Vercel: `foo/index.ts` responde em `/foo`.

**Máquina de estados** (`api/_lib/stateMachine.ts`) é o único lugar que decide se
`applications.status` pode ir de A para B — nenhum handler faz `UPDATE` direto no status. Toda
transição grava uma linha em `audit_log` por construção.

**LGPD é estrutural, não decorativa**: campos sensíveis (`*_encrypted` em `api/_lib/schema.ts`)
são cifrados com AES-256-GCM (`api/_lib/crypto.ts`) e só saem em claro através de
`decryptField()`, que sempre grava uma linha em `audit_log` (`action: 'pii.decrypted'`). Ler PII
sem passar por essa função é o bug mais grave possível neste projeto. `cpfHash` (HMAC-SHA256)
permite dedupe por CPF sem nunca decriptar.

**Decisão de crédito nunca vem de IA.** `api/_lib/decision.ts::decide()` é puro, determinístico,
sem I/O. A IA (Claude, Fase 4) só gera texto explicando uma decisão já tomada — nunca decide.
Essa fronteira é deliberada (auditabilidade/responsabilidade), não uma limitação técnica. A ordem
de checagem dentro de `decide()` importa: restrição de veículo nega antes de qualquer outra coisa,
fraude grave força revisão humana antes do resto — ver comentário no topo da função.

**Bureau de crédito é simulado** (`api/_lib/bureau.ts`) — Serasa/SPC real exige CNPJ e contrato
comercial, inviável para portfólio. Determinístico por CPF (mesmo CPF → mesmo resultado).

**Extração de documento por IA** (`api/_lib/claude.ts` + `api/_lib/documentExtraction.ts`,
Fase 2): a IA lê o documento (imagem/PDF) e devolve campos estruturados via tool use — nunca
decide nada, só extrai. `runExtraction()` roda **de forma síncrona** logo após o upload no
portal do cliente (`api/client/[token]/documents.ts`), desvio deliberado do plano original
("assíncrono, não bloqueia o upload"): uma função Vercel Node comum não tem como continuar
trabalhando depois de `res.end()` sem depender de uma API específica do Vercel (`waitUntil`),
o que quebraria a portabilidade dev/produção que o projeto inteiro preserva. A troca é a
resposta demorar alguns segundos a mais, mas sem precisar de polling — o cliente já recebe o
status final na mesma requisição.

Confiança abaixo de 75%, qualquer `issue` reportado pelo modelo, ou um CPF que falha no
checksum (`api/_lib/cpfValidation.ts`) força `needs_review` mesmo com confiança alta — o
checksum roda sempre em cima do que a IA extrai, nunca confia cegamente. Sem `ANTHROPIC_API_KEY`
configurada, a extração falha (`documents.status = 'failed'`) de forma previsível — não derruba
a requisição, só fica pendente de retry manual (`POST /api/documents/[id]/extract`).

`api/bureau/check.ts` só avança a proposta para `running_checks` quando **todo** documento da
proposta está `extracted` com a extração mais recente em `auto_accepted`/`reviewed` — senão,
para em `documents_review_required` até o dealer resolver via
`PATCH /api/documents/[id]/extract` (`approve`/`correct`/`reject`).

**Consulta veicular e anti-fraude** (Fase 3) rodam junto com o bureau, na mesma chamada a
`api/bureau/check.ts` — sem endpoints próprios, sem estado novo na máquina.

- `api/_lib/fipe.ts`: preço FIPE **real**, via BrasilAPI (`marcas → veiculos → anos → detalhes`,
  cadeia confirmada lendo o código-fonte deles, verificada também contra a API ao vivo). Cache em
  memória de processo pra marca/modelo. A loja digita marca/modelo como texto livre — melhor
  correspondência por nome normalizado; sem correspondência ou API fora do ar, devolve tudo
  `null` (enriquecimento, nunca bloqueia a esteira).
- `api/_lib/vehicleRestriction.ts`: restrição de roubo/furto/gravame por placa, **simulada** —
  não existe API pública gratuita pra isso no Brasil (só o app do Sinesp, sem API pra terceiros;
  provedores comerciais exigem contrato, mesma limitação do bureau). Determinístico por placa.
- `api/_lib/antifraud.ts`: metade **real** (cruza CPF/nome declarados na proposta com o que a IA
  extraiu do documento na Fase 2, calcula idade a partir da data de nascimento — dado que já
  existia no sistema, só nunca tinha sido cruzado) + metade **simulada** ("base de fraudadores
  conhecidos", mesma limitação de contrato comercial do bureau).
- `decision.ts` usa os três: veículo com restrição nega automaticamente (checado primeiro, antes
  de qualquer outra coisa); flag grave de antifraude (`cpf_mismatch`/`known_fraud_list`) força
  `manual_review`, nunca aprova sozinho; LTV alto (valor pedido ÷ valor FIPE) vira fator de risco,
  não bloqueio automático.

## Convenções herdadas do painel-do-ar

- `@/` aponta para `src/` (dealer + client + shared); `api/` sempre usa import relativo.
- Handlers são `(req, res) => Promise<void>` puros, sem `req.query`/`req.body` do Vercel — path
  params vêm de `pathSegment`/`lastPathSegment` em `api/_lib/http.ts`, body de `readJsonBody`.
- `getDb()` escolhe Postgres real (`DATABASE_URL` definida) ou PGlite embutido (sem env var);
  em teste (`VITEST`), PGlite roda em memória por worker.
- Testes de `api/` rodam em ambiente Node contra PGlite real (nunca mockam o banco); testes de
  frontend usam MSW na camada HTTP.
- CI: typecheck → lint → test:coverage → build.

## Limitações conhecidas e deliberadas (não "consertar" sem entender por quê)

- `ENCRYPTION_KEY`/`SESSION_SECRET` únicas via env var, com fallback fixo e não-secreto em
  dev/test — simplificação de portfólio; produção real usaria um KMS gerenciado.
- Documentos no Vercel Blob ficam com `access: 'public'` (URL aleatória, não indexada, mas não
  genuinamente privada) — limitação da API atual do Blob, documentada em `api/_lib/storage.ts`.
- Open Finance Brasil (Fase 5, ainda não implementada) precisa de credenciamento manual no
  sandbox do Bacen — não é algo que uma sessão de código resolve sozinha.
- Todo dado usado em desenvolvimento deve ser sintético. Nunca use CPF, nome ou documento reais.
