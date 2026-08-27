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

**Parecer de risco por IA** (`api/_lib/claude.ts::generateNarrative` + `api/_lib/riskNarrative.ts`,
Fase 4): roda **depois** de `decide()` já ter decidido e a linha já estar em `credit_decisions` —
nunca decide nada, só explica os `factorsJson` já persistidos (incluindo os fatores da Fase 3:
restrição de veículo, LTV, score de antifraude). Chamada síncrona, mesma justificativa da
extração de documento (Fase 2): sem jeito portável de continuar trabalhando depois de
`res.end()` numa função Vercel Node comum. Gera duas versões — técnica pro dealer, em linguagem
simples pro cliente — via tool use, mesmo padrão de `extractDocument`. Não-bloqueante por design:
se a chamada falhar, a decisão persiste sem parecer (`risk_narrative_* = null`) e não derruba a
requisição; `POST /api/applications/[id]/narrative` é o retry manual, disponível tanto no painel
do dealer quanto reaproveitado pelo fluxo de revisão manual (`resolve.ts`) — toda nova linha em
`credit_decisions` tenta gerar parecer, seja do motor automático ou de uma decisão humana.

**Open Finance Brasil é simulado** (`api/_lib/openfinance.ts`, Fase 5) — **não** por falta de
esforço, mas por barreira regulatória: pesquisa feita antes de começar a fase mostrou que
participar do Open Finance, mesmo em sandbox, exige a instituição ser autorizada pelo Banco
Central (o cadastro no Diretório de Participantes pede prova dessa autorização). Não é um
cadastro de desenvolvedor — nem contrato comercial resolveria, diferente do bureau. `Mock
OpenFinanceClient` é determinístico por CPF, mesmo espírito de `bureau.ts`; `RealOpenFinanceClient`
existe só pra documentar o formato de uma integração real (OAuth2/FAPI/mTLS) — cada método lança
um erro explícito em vez de fingir funcionar, porque um cliente real nunca testado contra um
servidor de verdade seria pior que não escrever.

Fluxo simulado sem redirecionamento real (não há banco de sandbox pra ir e voltar):
`api/bureau/check.ts` foi dividido em duas fases pela mesma chamada — a fase de documentos agora
**para** em `awaiting_openfinance_consent` em vez de pular automático como nas Fases 2-4, porque
existe um passo real do cliente ali (`POST /api/client/[token]/openfinance`, `{decision: 'authorize'
| 'deny'}`, cria o consentimento e já busca o dado simulado numa chamada só); a fase de checagens
libera a partir de `openfinance_authorized` **ou** `openfinance_failed` — consentimento negado é
legítimo e não bloqueia. `decision.ts` usa a renda estimada pelo Open Finance simulado como mais
um fator: muito abaixo da declarada empurra pra `manual_review` (nunca bloqueia sozinha), ausência
de dado nunca penaliza.

## Hardening de LGPD e polimento (Fase 6)

**Consentimento granular**: `consent_records` (tabela própria, distinta de `openfinance_consents`
— "o titular deixou eu processar o dado" vs. "autorizou o banco simulado a compartilhar") é
gravado em cada passo relevante do portal do cliente, não só uma vez no cadastro:
`POST /api/client/[token]/submit` grava `data_processing` sempre (checkbox obrigatório) e
`bureau_check`/`ai_narrative_share` conforme dois checkboxes opcionais adicionais — não autorizar
os dois últimos não bloqueia o envio, é uma escolha legítima do titular (a esteira não força a
lógica de bloqueio real hoje: gravar o consentimento é o requisito de LGPD desta fase, condicionar
o comportamento das checagens a ele ficaria para uma fase futura). `POST
/api/client/[token]/openfinance` grava `openfinance_share` só quando o cliente de fato autoriza o
Open Finance simulado. O endpoint genérico `POST /api/client/[token]/consent` (existente desde a
Fase 1) continua disponível para revogação futura.

**Máscara/revelação de PII**: `api/applications/[id].ts` não decripta mais `cpf` nem
`monthlyIncomeDeclared` por padrão — devolve `cpfMasked` (constante, já que não há como mostrar
dígitos parciais sem decriptar) e `hasMonthlyIncomeDeclared` (booleano). Só
`POST /api/applications/[id]/reveal` (`{ field: 'cpf' | 'monthlyIncomeDeclared' }`) decripta em
claro, restrito a `admin`/`manager` via `requireDealerRole()` (novo guard em `auth.ts` — um
`analyst` opera a esteira inteira sem precisar disso). `crypto.ts::DecryptFieldContext` ganhou um
`action?: string` opcional; `reveal.ts` passa `action: 'pii.revealed'` em vez do `'pii.decrypted'`
genérico — a trilha de auditoria distingue "sistema decriptou pra calcular algo" de "um humano
clicou em revelar". Nome/telefone/e-mail continuam abertos no detalhe (já apareciam sem máscara em
outras telas do dealer e não são, isoladamente, os campos mais sensíveis do cadastro).

**Trilha de auditoria visível**: `GET /api/applications/[id]/audit-log` lista `audit_log` por
proposta (até 200 linhas, mais recente primeiro), aberto a qualquer papel autenticado — diferente
de `reveal.ts` — porque `metadataJson` nunca carrega valor de PII por construção (ver
`audit.ts`), então o próprio log é seguro de mostrar. `AuditLogPanel.tsx` no painel do dealer
renderiza essa lista; como toda decriptação e toda transição de estado já passavam por
`logAction()` desde a Fase 1, esta fase não precisou "completar" a auditoria — só expor o que já
existia.

**Retenção de dado** (`api/cron/retention-sweep.ts`, roda 1x/dia): anonimiza nome/CPF/telefone/
e-mail/documentos/extrações de propostas paradas há tempo demais num estado terminal —
`denied`/`expired`/`cancelled`/`offer_declined` (janela curta, `RETENTION_WINDOW_DAYS`, padrão 90
dias) ou `offer_accepted` (janela própria e mais longa, `RETENTION_WINDOW_ACCEPTED_DAYS`, padrão
~5 anos, ordem de grandeza de guarda de registro financeiro). CPF/nome/telefone/e-mail são
sobrescritos com um valor sentinela cifrado (não podem ser `NULL`, são `NOT NULL` no schema) e
`cpfHash` é randomizado — sem isso, uma proposta nova de verdade da mesma pessoa colidiria com a
linha já esvaziada (ver comentário em `applicants.anonymizedAt`, `schema.ts`). Guarda de
segurança real, não hipotética: como `applications/index.ts` reaproveita o mesmo `applicants` por
`cpfHash` (dedupe de cliente recorrente), o sweep pula um applicant que ainda tenha outra proposta
em andamento (`skippedActiveSibling`) — anonimizar cedo demais apagaria dado que uma proposta
irmã ainda precisa. `?dryRun=true` reporta o que seria anonimizado sem escrever nada. Documentos
são apagados via `storage.ts::deleteDocument()` (best-effort, engole erro — mesmo padrão de
cache best-effort do painel-do-ar) antes de zerar `applicants`.

`api/cron/expire-links.ts` (roda 1x/dia, antes do sweep) transiciona para `expired` toda proposta
em `link_sent` cujo token já venceu — sem isso ela nunca chegaria a um estado terminal e nunca
entraria na janela de retenção. Os dois crons são protegidos por `CRON_SECRET` (mesmo padrão do
painel-do-ar) e registrados em `vercel.json`.

**Rate limiting**: `api/_lib/rateLimit.ts` é um limitador de janela fixa **em memória de
processo** — limitação de escopo de portfólio documentada no próprio arquivo: cada instância
serverless tem seu mapa próprio, sem coordenação entre invocações concorrentes (produção real
usaria Redis/Upstash). Aplicado a `POST /api/auth/login` (10 tentativas / 5 min por IP) e a todos
os endpoints de token do cliente — `client/[token].ts` e as rotas `client/[token]/*` — porque o
token _é_ a autenticação ali (sem senha), então limitar a taxa de adivinhação importa tanto quanto
no login. `Cache-Control: no-store` foi adicionado às respostas que carregam PII ou token
(`applications/[id].ts`, `client/[token].ts`, `reveal.ts`, `audit-log.ts`).

**Dado de demonstração**: `scripts/seed.ts` cria 7 propostas sintéticas cobrindo os principais
estados da esteira (`link_sent`, `documents_review_required`, `awaiting_openfinance_consent`,
`manual_review`, `offer_created`, `denied`, `offer_accepted`) — só roda se o banco ainda não
tiver nenhuma proposta, pra não duplicar em reruns. Reescrito na Fase "seed redondo" (pós Fase 13)
pra reaproveitar os mesmos mocks determinísticos e o mesmo `decide()` que a esteira real usa
(`checkBureauMock`/`checkVehicleRestrictionMock`/`checkAntifraud`/`lookupFipeValue`/
`getOpenFinanceClient`), em vez de linhas de `credit_decisions` com outcome escolhido a dedo — o
`manual_review` de demonstração, por exemplo, é `manual_review` porque um CPF "extraído"
divergente do declarado realmente produz `cpf_mismatch` em `checkAntifraud`, e é esse sinal que
faz `decide()` decidir revisão manual, igual aconteceria num caso real. Uma das propostas
(`offer_created`) chama `lookupFipeValue()` de verdade contra a BrasilAPI no momento do seed —
único ponto do seed que depende de rede, com o mesmo fallback gracioso (`null`) de sempre se
estiver offline. `withScenario()` (helper local do script) troca temporariamente as env vars
`MOCK_*_SCENARIO` pra forçar cada cenário sem depender de achar por tentativa um CPF/placa cujo
hash caia no resultado certo. Inserido direto nas tabelas (sem passar por
`transition()`/`logAction()`): é histórico fabricado para a demo funcionar de cara, não uma
sequência real de eventos — não faria sentido aparecer na trilha de auditoria como se fosse.

## Rodada 2 — navegação, documentos, avaliação veicular, redesign (Fases 7-10)

Pedida pelo usuário depois de rodar o projeto localmente pela primeira vez (um bug relatado + três
melhorias de produto/design). Fases 7-9 são mudanças pontuais; a Fase 10 é a repaginação visual
completa. A Fase 11 (revalidação geral) fechou a rodada sem precisar de nenhuma correção de
código — ver "Verificação real de ponta a ponta" abaixo.

**Fase 7 — layout compartilhado do dealer**: `NewApplicationPage.tsx` e `ApplicationDetailPage.tsx`
não tinham cabeçalho nenhum — só `ApplicationsListPage.tsx` tinha, então depois de criar uma
proposta o usuário caía numa tela sem jeito de voltar. `src/dealer/components/DealerLayout.tsx` é
agora a rota pai (nested routes do React Router) de toda rota autenticada do dealer, com cabeçalho
persistente; cada página interna ainda ganhou um link contextual "← Voltar para propostas". Nessa
mesma sessão foi corrigido um bug relacionado, mas anterior a esta rodada: `vite.portal-plugin.ts`
reescrevia `/@react-refresh`/`/@vite/client` (módulos internos do Vite, sem ponto no nome) para
`dealer.html` por engano — causava tela branca sempre, em qualquer navegador.

**Fase 8 — documento com dado manual + passaporte**: `documents.manualFieldsEncrypted` (cifrado,
mesma disciplina de todo campo PII) guarda o que o cliente digita junto com a foto no upload —
redundância deliberada pro dealer comparar com o que a IA extraiu, útil sobretudo quando a
extração falha ou pede revisão. `documentTypeEnum` ganhou `'passaporte'` como mais um tipo de
documento de identidade — **CPF continua obrigatório pra todo comprador** (é o identificador do
contrato de crédito no Brasil); passaporte não substitui isso, é só uma opção a mais pra
comprador estrangeiro comprovar identidade. `src/shared/documentTypes.ts` é a fonte única de
tipo/rótulo/campo manual esperado, reaproveitada pelo portal do cliente e pela revisão do dealer.

**Fase 9 — FIPE na criação**: `lookupFipeValue()` (real, BrasilAPI, desde a Fase 3) já existia, só
rodava tarde demais (dentro de `api/bureau/check.ts`, depois de todo o resto). Novo
`GET /api/vehicles/fipe-lookup` é um wrapper fino que deixa o dealer consultar o valor já na tela
de criação — puramente informativo, não persiste nada nem altera a proposta automaticamente
(`decision.ts` continua o único lugar que decide algo).

**Fase 10 — design system**: tipografia Sora (títulos) + Inter (corpo) via Google Fonts com
fallback pra pilha de sistema (nunca quebra visualmente offline), paleta ampliada com tokens
semânticos (success/warning/danger), botões em pílula, cards com sombra, badges com indicador de
cor. Reaproveita as mesmas classes já existentes — poucas mudanças de markup, a maior parte é
`src/shared/styles.css`. Adições novas: chips de contagem por status na fila
(`ApplicationsListPage.tsx`), indicador de progresso no portal do cliente
(`ProgressStepper.tsx`, derivado do `status` que a API já devolve, sem mudança de contrato).

**Verificação real de ponta a ponta (Fase 11)**: além do pipeline automatizado, o caminho feliz
completo foi exercitado com um navegador de verdade (Playwright headless) contra o dev server —
criar proposta com consulta FIPE → cliente preenche dados com os 3 consentimentos granulares →
envia passaporte com dado manual → autoriza Open Finance → dealer roda checagens → calcula decisão
→ (sem oferta nesse caso, porque o mock de restrição veicular acusou restrição pra placa de teste,
e `decision.ts` nega automático — comportamento correto, não bug). Sem `ANTHROPIC_API_KEY`
configurada (ambiente local sem chave), tanto a extração de documento quanto o parecer de risco
degradaram graciosamente exatamente como documentado (`documents.status = 'failed'` com retry
manual; decisão persistiu com `risk_narrative_* = null` e botão "Gerar parecer") — confirma que a
degradação sem IA funciona no fluxo real, não só nos testes mockados. Zero erros de console em
todas as telas, nenhuma tela sem saída. Achados que não são bugs, mas ficaram registrados pra uma
eventual fase futura: não existe UI pra reenviar/regenerar o link do cliente quando expira (o
endpoint `POST /api/applications/[id]/link` existe desde a Fase 1, mas nunca foi conectado a um
botão); `GET /api/applications` corta em 100 propostas sem paginação; a tela de detalhe não mostra
quais dos consentimentos granulares (Fase 6/8) o cliente de fato marcou.

## Fase 12 — as 3 lacunas levantadas na revalidação

Fechamento da Rodada 2: as 3 lacunas que a Fase 11 registrou (não eram bugs, só incompleto).

**Reenvio de link do cliente**: `POST /api/applications/[id]/link` existia desde a Fase 1, mas
nunca tinha sido conectado a um botão — o dealer só conseguia gerar um novo link chamando a API
diretamente. Botão "Reenviar link" na seção "Link do cliente" de `ApplicationDetailPage.tsx`
resolve isso; a chamada já invalida a query e o `clientPortalToken` novo aparece sozinho.

**Paginação da fila**: `api/applications/index.ts::handleList` cortava fixo em 100 registros, sem
nenhum jeito de ver o resto. Agora pagina por offset (`?page=`, 25 por página — simples o
bastante pro volume de um portfólio, sem cursor). Os chips de estatística no topo da fila
(`No total`/`Aguardando revisão`/`Aprovadas`/`Encerradas`) **não** são calculados a partir da
página carregada — um `GROUP BY status` separado no mesmo endpoint garante que ficam corretos
independente de qual página o dealer está vendo (calculá-los só a partir de `items` da página
atual ficaria ativamente enganoso assim que a fila passasse de 25 propostas).

**Visibilidade dos consentimentos granulares**: `consent_records` (Fase 6) já gravava
`data_processing`/`bureau_check`/`ai_narrative_share`/`openfinance_share` com `grantedAt`, mas
nada na UI do dealer mostrava isso — só existia implicitamente no banco/audit log.
`api/applications/[id].ts` passa a incluir a lista de consentimentos da proposta (ordenada por
`grantedAt` desc — o primeiro de cada tipo já é o mais recente, sem precisar de agrupamento
manual); nova seção "Consentimentos" no detalhe lista os 4 tipos, mostrando "Não concedido"
quando o titular não marcou aquele item.

## Fase 13 — feedback de erro nas ações do dealer + validação real de CPF

Depois de usar o painel, o usuário reportou 3 problemas: os botões "Tentar extrair de novo" e
"Gerar parecer" pareciam não fazer nada ao clicar; criar uma proposta com um CPF de 10 dígitos
falhava com uma mensagem genérica sem dizer por quê; e pediu pra limpar o dado de teste
acumulado. Investigação mostrou que os dois primeiros não eram bugs de lógica — eram ausência de
feedback visual quando uma ação falha:

- `POST /api/documents/[id]/extract` (retry de extração) **sempre responde 200**, mesmo quando a
  extração falha de novo (`runExtraction` engole o erro por design). O botão só invalidava a
  query — como o `status` continuava `failed`, a tela voltava exatamente como estava, sem
  indicação de que algo foi tentado. `DocumentReviewCard.tsx` agora checa o resultado da mutação
  (`retry.data?.documentStatus === 'failed'`) e mostra uma mensagem específica.
- `POST /api/applications/[id]/narrative` (retry de parecer) responde 502 quando a IA falha, mas
  `ApplicationDetailPage.tsx` não tratava `isError` — o erro lançado por `apiFetch` desaparecia
  em silêncio.
- CPF com menos de 11 dígitos só era pego pelo `min(11)` do zod no backend, depois de uma
  requisição — `NewApplicationPage.tsx` mostrava sempre a mesma mensagem genérica. `isValidCpf`
  (checksum módulo 11, já existente em `api/_lib/cpfValidation.ts` pra validar o que a IA extrai
  de documento) foi duplicada em `src/shared/cpfValidation.ts` — não dá pra importar de `api/_lib`
  no frontend, bundles separados — e passa a barrar o envio no formulário antes de gastar uma
  requisição.

O mesmo padrão (mutação sem `isError` tratado) se repetia em quase toda ação do painel do dealer
— `revealCpf`, `revealIncome`, `runBureauCheck`, `runDecision`, `resolveManualReview`,
`createOffer`, `resendLink` (`ApplicationDetailPage.tsx`) e `review`
(`DocumentReviewCard.tsx`) — só o portal do cliente já tinha isso desde o início. Todas ganharam
uma mensagem específica, mesmo padrão simples (`{mutation.isError && <p className="form-error">...</p>}`)
que o portal do cliente já usava — sem componente novo, sem abstração.

## Rodada 3 — novas adições à esteira (Fase 14 em diante)

Depois de reconstruir o banco de demonstração local (7 propostas ricas, ver seção "Dado de
demonstração" acima), o usuário pediu sugestões de melhoria pra esteira; seis foram curadas e
planejadas como fases próprias (14-19), aprovadas uma a uma. Plano completo em
`C:\Users\Gustavo\.claude\plans\streamed-percolating-quilt.md`.

**Fase 14 — edição de proposta em `draft`/`link_sent`/`client_submitted`**: o backend
(`handlePatch` em `api/applications/[id].ts`) já existia desde cedo no projeto e nunca tinha UI —
essa fase é quase inteiramente frontend. Única lacuna real do backend: `vehiclePlate` não estava
no `patchSchema` apesar de ser coluna `NOT NULL` — corrigido. `src/shared/editableStatuses.ts`
duplica a constante `EDITABLE_STATUSES` do backend (mesmo motivo de `cpfValidation.ts` na Fase
13: frontend não importa de `api/_lib`) só pra decidir se mostra o formulário — o backend
continua sendo a única fonte de verdade, recusando com 409 fora desses três status independente
do que a UI decidir renderizar. `src/dealer/components/EditApplicationForm.tsx` é um componente
à parte (não inline em `ApplicationDetailPage.tsx`) que recebe a proposta já carregada como prop
e inicializa seu próprio estado via inicializador preguiçoso do `useState` — dispensa `useEffect`
de sincronização porque a página inteira remonta ao trocar de proposta (rota por `id`).

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
- `api/_lib/rateLimit.ts` é em memória de processo, sem coordenação entre instâncias serverless
  concorrentes — reduz força bruta óbvia, mas não é a solução de produção (Redis/Upstash).
- Open Finance Brasil é e sempre será simulado neste projeto — participar de verdade exige a
  instituição ser autorizada pelo Banco Central, uma barreira regulatória que nenhuma sessão de
  código (nem um cadastro de desenvolvedor, nem dinheiro) resolve pra um projeto de portfólio.
  Ver a seção "Open Finance Brasil é simulado" acima.
- Todo dado usado em desenvolvimento deve ser sintético. Nunca use CPF, nome ou documento reais.
