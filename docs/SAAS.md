# Plataforma de gestão de academias (SaaS)

A área de gestão é uma camada sobre o app de treino do openGym. O app de treino (plano, treino,
histórico, sincronização) continua igual; a gestão acrescenta academias, pessoas, fichas,
financeiro, insumos e PDV.

## Como as peças se encaixam

| Parte | Onde | O que faz |
|---|---|---|
| Banco | `DATA_DIR/saas.db` (SQLite embutido do Node, `node:sqlite`) | Academias, pessoas, fichas, financeiro, estoque, vendas. Nenhuma dependência nova. Migrações em `api/saas/migrations.js` (só se acrescenta, nunca se edita uma que já saiu). |
| API | `api/saas/*.js`, montada em `server.js` | Rotas `/api/saas/*`, com a mesma sessão, checagem de origem e tratamento de erro das outras rotas. |
| Telas | `frontend/src/saas/` | Rota `/#/gestao`, layout largo com menu lateral, textos em pt-BR (fora dos pacotes de tradução). |
| Contas | `db.json` do app (passkey ou senha) | A pessoa cria a conta normal do app e liga à academia com um código de convite. |

Arquivos da API:

- `router.js`: rotas com parâmetros, controle de acesso por papel, auditoria.
- `db.js`, `migrations.js`: banco e esquema. `ledger.js`: o único caminho do dinheiro e do estoque (lançamentos e movimentos).
- `calc.js`: regras puras de dinheiro e datas, com teste (`test/saas-calc.test.js`).
- `gyms.js`, `members.js`, `training.js`, `finance.js`, `supplies.js`, `pos.js`, `platform.js`: um módulo por área.

## Papéis

| Papel | Pode |
|---|---|
| Administrador da plataforma | Tudo, em todas as academias (é o `isAdmin` da instância: `ADMIN_UIDS` ou admin dado no painel). Suspende academias, bloqueia usuários. |
| Administrador da academia (`gym_admin`) | Tudo na própria academia: pessoas, fichas, financeiro, insumos, PDV, configurações. |
| Instrutor (`trainer`) | Alunos (cadastrar e editar alunos, não a equipe), fichas e atribuições, acompanhamento, vender no PDV. Não vê dinheiro. |
| Aluno (`student`) | "Minha academia": instrutor, fichas atribuídas (adiciona ao próprio plano com um toque), mensalidades. |

Isolamento entre academias: toda tabela de academia tem `gym_id` e toda consulta filtra por ele; um id de outra academia responde 404. A academia suspensa responde 423 para todos, menos para a plataforma.

## Fluxos principais

- **Cadastro:** qualquer conta cadastra uma academia (`PUBLIC_SIGNUP_GYMS=off` restringe à plataforma) e vira administradora dela.
- **Convite:** cada pessoa cadastrada ganha um código `XXXX-XXXX`. Ela cria a conta no app e digita o código em Gestão. O código pode ser enviado pelo WhatsApp e regenerado (desvinculando a conta anterior).
- **Ficha de treino:** gravada no formato de plano compartilhado do app (`opengym_plan: 1`, ver `frontend/src/lib/plan-share.js`). Cada atribuição guarda uma cópia; o aluno importa com `parsePlan` + `mergePlan`, o mesmo caminho de um arquivo de plano compartilhado, então unidades e carimbos de sincronização ficam corretos. Exercícios: catálogo do app (5.632).
- **Mensalidades:** plano → assinatura do aluno (dia de vencimento 1 a 28) → "Gerar mensalidades do mês" (não duplica) → "Receber" lança a entrada. "Desfazer" reabre e estorna.
- **PDV:** abrir caixa com troco → vender (estoque baixa e entrada é lançada na mesma transação) → sangria/suprimento → fechar com contagem (mostra sobra ou falta). Fiado cria uma cobrança no aluno; a entrada só aparece quando ele paga. Cancelar a venda devolve o estoque e estorna.
- **Compras:** pedido (rascunho → enviado → recebido). Receber põe os itens no estoque e lança a despesa (insumos e produtos de revenda em categorias separadas). Cancelar um pedido recebido desfaz os dois.

## Configuração (`.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `PLATFORM_NAME` | `FitHub Gestão` | Nome mostrado na gestão. |
| `PUBLIC_SIGNUP_GYMS` | `on` | `off`: só a plataforma cadastra academias. |
| `SOURCE_URL` | repositório TeamHelperO | Link de código-fonte do rodapé (exigência da AGPL). |
| `EXERCISE_MEDIA` | `off` | Build arg da imagem web. `on` só com licença própria da Gym visual. |
| `SAAS_MODE` | `on` | `off` desliga a área de gestão (as rotas `/api/saas/*` respondem 404). |

O nome do app de treino vem de `VITE_BRAND_NAME` no build do frontend (`frontend/.env.production`: `FitHub`). O `t()` troca "openGym" pelo nome em todas as frases traduzidas, sem mexer nos pacotes de idioma.

## Backup

Além do que o `docs/SELF_HOSTING.md` já pede, guarde `data/saas.db` (e `saas.db-wal` se existir, ou pare a API antes) e `data/saas-logos/`.

## Rotas

Todas sob `/api/saas`, JSON, com o cookie de sessão do app. Não estão no `openapi.yaml` (que documenta a API do app de treino); a lista é esta, gerada de `createSaas().routes()`:

| Método | Caminho |
|---|---|
| `GET` | `/api/saas/config` |
| `GET` | `/api/saas/me` |
| `POST` | `/api/saas/gyms` |
| `POST` | `/api/saas/join` |
| `GET` | `/api/saas/gyms/:gymId` |
| `PUT` | `/api/saas/gyms/:gymId` |
| `PUT` | `/api/saas/gyms/:gymId/logo` |
| `DELETE` | `/api/saas/gyms/:gymId/logo` |
| `GET` | `/api/saas/gyms/:gymId/logo` |
| `GET` | `/api/saas/gyms/:gymId/dashboard` |
| `GET` | `/api/saas/gyms/:gymId/members` |
| `POST` | `/api/saas/gyms/:gymId/members` |
| `GET` | `/api/saas/gyms/:gymId/members/:memberId` |
| `PUT` | `/api/saas/gyms/:gymId/members/:memberId` |
| `POST` | `/api/saas/gyms/:gymId/members/:memberId/status` |
| `POST` | `/api/saas/gyms/:gymId/members/:memberId/invite` |
| `GET` | `/api/saas/gyms/:gymId/members/:memberId/progress` |
| `GET` | `/api/saas/gyms/:gymId/workouts` |
| `POST` | `/api/saas/gyms/:gymId/workouts` |
| `GET` | `/api/saas/gyms/:gymId/workouts/:workoutId` |
| `PUT` | `/api/saas/gyms/:gymId/workouts/:workoutId` |
| `DELETE` | `/api/saas/gyms/:gymId/workouts/:workoutId` |
| `POST` | `/api/saas/gyms/:gymId/workouts/:workoutId/assign` |
| `GET` | `/api/saas/gyms/:gymId/assignments` |
| `POST` | `/api/saas/gyms/:gymId/assignments/:assignmentId/archive` |
| `GET` | `/api/saas/gyms/:gymId/my` |
| `POST` | `/api/saas/gyms/:gymId/my/assignments/:assignmentId/imported` |
| `GET` | `/api/saas/gyms/:gymId/plans` |
| `POST` | `/api/saas/gyms/:gymId/plans` |
| `PUT` | `/api/saas/gyms/:gymId/plans/:planId` |
| `GET` | `/api/saas/gyms/:gymId/subscriptions` |
| `POST` | `/api/saas/gyms/:gymId/subscriptions` |
| `POST` | `/api/saas/gyms/:gymId/subscriptions/:subId/cancel` |
| `GET` | `/api/saas/gyms/:gymId/charges` |
| `POST` | `/api/saas/gyms/:gymId/charges` |
| `POST` | `/api/saas/gyms/:gymId/charges/generate` |
| `POST` | `/api/saas/gyms/:gymId/charges/:chargeId/pay` |
| `POST` | `/api/saas/gyms/:gymId/charges/:chargeId/reopen` |
| `POST` | `/api/saas/gyms/:gymId/charges/:chargeId/cancel` |
| `GET` | `/api/saas/gyms/:gymId/categories` |
| `POST` | `/api/saas/gyms/:gymId/categories` |
| `DELETE` | `/api/saas/gyms/:gymId/categories/:categoryId` |
| `GET` | `/api/saas/gyms/:gymId/transactions` |
| `POST` | `/api/saas/gyms/:gymId/transactions` |
| `POST` | `/api/saas/gyms/:gymId/transactions/:txId/cancel` |
| `GET` | `/api/saas/gyms/:gymId/cashflow` |
| `GET` | `/api/saas/gyms/:gymId/suppliers` |
| `POST` | `/api/saas/gyms/:gymId/suppliers` |
| `PUT` | `/api/saas/gyms/:gymId/suppliers/:supplierId` |
| `GET` | `/api/saas/gyms/:gymId/supplies` |
| `POST` | `/api/saas/gyms/:gymId/supplies` |
| `PUT` | `/api/saas/gyms/:gymId/supplies/:itemId` |
| `POST` | `/api/saas/gyms/:gymId/supplies/:itemId/stock` |
| `GET` | `/api/saas/gyms/:gymId/stock-movements` |
| `GET` | `/api/saas/gyms/:gymId/purchases` |
| `POST` | `/api/saas/gyms/:gymId/purchases` |
| `GET` | `/api/saas/gyms/:gymId/purchases/:orderId` |
| `PUT` | `/api/saas/gyms/:gymId/purchases/:orderId` |
| `POST` | `/api/saas/gyms/:gymId/purchases/:orderId/order` |
| `POST` | `/api/saas/gyms/:gymId/purchases/:orderId/receive` |
| `POST` | `/api/saas/gyms/:gymId/purchases/:orderId/cancel` |
| `GET` | `/api/saas/gyms/:gymId/products` |
| `POST` | `/api/saas/gyms/:gymId/products` |
| `PUT` | `/api/saas/gyms/:gymId/products/:productId` |
| `POST` | `/api/saas/gyms/:gymId/products/:productId/stock` |
| `GET` | `/api/saas/gyms/:gymId/cash` |
| `GET` | `/api/saas/gyms/:gymId/cash/sessions` |
| `GET` | `/api/saas/gyms/:gymId/cash/sessions/:sessionId` |
| `POST` | `/api/saas/gyms/:gymId/cash/open` |
| `POST` | `/api/saas/gyms/:gymId/cash/movement` |
| `POST` | `/api/saas/gyms/:gymId/cash/close` |
| `GET` | `/api/saas/gyms/:gymId/sales` |
| `POST` | `/api/saas/gyms/:gymId/sales` |
| `POST` | `/api/saas/gyms/:gymId/sales/:saleId/cancel` |
| `GET` | `/api/saas/platform/overview` |
| `GET` | `/api/saas/platform/gyms` |
| `POST` | `/api/saas/platform/gyms/:gymId/status` |
| `GET` | `/api/saas/platform/users` |
| `GET` | `/api/saas/platform/audit` |

## O que fica para depois

- Gateway de pagamento real (PIX com QR, boleto, cartão recorrente): hoje a baixa é manual.
- Contas bancárias/caixas separados no financeiro (hoje: categoria + forma de pagamento).
- Traduzir a área de gestão para os outros idiomas do app.
- Apps Android/iOS: identificadores de pacote, ícones e nome nas lojas ainda são os do openGym.
- O site `website/` é o do projeto original.
- Biblioteca de exercícios própria, quando vocês montarem a de vocês (o catálogo fica em `catalogue/`).
