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

## Entrada: um login, dois painéis

A tela de entrada é a mesma para todos. Depois de entrar:

- **Dono da plataforma, administrador de academia ou instrutor**: vai direto para o painel de gestão (`/gestao`), uma vez por sessão. O ícone "App de treino" no menu leva ao app.
- **Aluno**: vai para o app de treino. "Minha academia" fica no ícone de casa da tela inicial.

A primeira conta criada no servidor é a dona da plataforma (`FIRST_USER_ADMIN=1`, ligado no `.env.example`). É ela que cadastra a academia (ou várias) e vê tudo em "Administração da plataforma".

## Link de cadastro e domínio próprio

- Cada academia tem um link: `https://<servidor>/#/a/<identificador>` (em Configurações, com QR code e botão de WhatsApp). Quem abre vê a logo e o nome da academia na tela de entrada; ao criar a conta (ou entrar com uma existente) vira aluno dela, marcado "pelo link" na lista. A academia pode desligar o link e aceitar só código de convite.
- **Domínio próprio**: a academia informa `app.suaacademia.com.br` em Configurações e cria um CNAME para o servidor. A API reconhece a academia pelo `Host` (o nginx da imagem repassa). Para o HTTPS de vários domínios, ponha um proxy com certificados sob demanda na frente, por exemplo Caddy:

  ```
  {
    on_demand_tls {
      ask http://web:80/api/saas/public/domain-check
    }
  }
  https:// {
    tls { on_demand }
    reverse_proxy web:80
  }
  ```

  `GET /api/saas/public/domain-check?domain=` só responde 200 para domínios cadastrados por uma academia ativa, então ninguém consegue fazer o servidor pedir certificados à vontade.
- Chaves de acesso (passkeys) ficam presas ao `RP_ID`, o endereço principal. No domínio próprio o login é por e-mail e senha (`PASSWORD_LOGIN=1`).

## Catracas

A pessoa coloca o dedo no leitor, o equipamento reconhece a digital e pergunta ao sistema; o sistema confere o cadastro e responde liberando ou não a catraca. Tudo fica em "Catracas e acesso".

**Regras** (Configurações › Regras da catraca): aluno inativo não entra; academia suspensa não libera ninguém; aluno com mensalidade em atraso há mais que os dias de tolerância (padrão 5) é bloqueado (pode desligar); opcionalmente só aluno com plano ativo. Instrutores e administradores sempre entram. Cada tentativa fica registrada (quem, onde, liberado ou negado e o motivo).

**Control iD** (iDBlock, iDAccess, iDFlex, iDFace e similares), integração direta, formatos tirados dos exemplos oficiais do fabricante ([controlid/integracao](https://github.com/controlid/integracao)):

- **Modo online Pro**: a digital é reconhecida no equipamento, que manda o número da pessoa para `POST /new_user_identified.fcgi`. A resposta é `event: 7` com a ação `catra` (`allow=clockwise`, `anticlockwise` ou `both`), `door` ou `sec_box` para liberar, ou `event: 6` com o motivo na tela para negar. Cartão: `/new_card.fcgi`.
- **Modo push**: o equipamento consulta `GET /push` a cada poucos segundos e executa o que estiver na fila: `create_objects` (enviar pessoas), `remote_enroll` (cadastrar digital: o equipamento pede o dedo) e `execute_actions` (girar a catraca pela recepção). O resultado volta em `POST /result`. É assim que um servidor na nuvem alcança um equipamento atrás do roteador da academia.
- O equipamento é reconhecido pelo número de série cadastrado no painel (opcionalmente também pelo IP público). O "nº de acesso" de cada pessoa (a partir de 1001 por academia) é o id dela no equipamento.
- Configuração no equipamento: servidor online e push apontando para o endereço da plataforma (o painel mostra o passo a passo em "Como conectar"). O nginx da imagem encaminha esses caminhos da raiz para a API.

**Outras marcas** (Henry, Topdata, Intelbras, Hikvision...): não falam o protocolo da Control iD. O software do fabricante ou um pequeno programa na academia chama `POST /api/saas/access/check` com o token do equipamento (`Authorization: Bearer ...`) e `{ "identifier": "1002", "method": "access_id" | "card" | "cpf" }`, e recebe `{ allow, message, name }`. Integrações nativas dessas marcas ficam para quando houver um equipamento para testar.

**Não testado com equipamento físico**: os testes simulam o equipamento com as chamadas e respostas dos exemplos oficiais. Antes de colocar em produção, valide com a catraca da academia (liberação, cadastro de digital e o modo de contingência sem internet configurado no próprio equipamento).

## Configuração (`.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `PLATFORM_NAME` | `FitHub Gestão` | Nome mostrado na gestão. |
| `PUBLIC_SIGNUP_GYMS` | `on` | `off`: só a plataforma cadastra academias. |
| `SOURCE_URL` | repositório TeamHelperO | Link de código-fonte do rodapé (exigência da AGPL). |
| `EXERCISE_MEDIA` | `off` | Build arg da imagem web. `on` só com licença própria da Gym visual. |
| `FIRST_USER_ADMIN` | `1` no `.env.example` | A primeira conta vira dona da plataforma. |
| `PASSWORD_LOGIN` | `1` no `.env.example` | Login por e-mail e senha (necessário no domínio próprio). |
| `ALLOW_GUEST` | `0` no `.env.example` | Sem modo visitante. |
| `SAAS_MODE` | `on` | `off` desliga a área de gestão (as rotas `/api/saas/*` respondem 404). |

O nome do app de treino vem de `VITE_BRAND_NAME` no build do frontend (`frontend/.env.production`: `FitHub`). O `t()` troca "openGym" pelo nome em todas as frases traduzidas, sem mexer nos pacotes de idioma.

## Backup

Além do que o `docs/SELF_HOSTING.md` já pede, guarde `data/saas.db` (academias, pessoas, financeiro, catracas) (e `saas.db-wal` se existir, ou pare a API antes) e `data/saas-logos/`.

## Rotas

Todas sob `/api/saas`, JSON, com o cookie de sessão do app. Não estão no `openapi.yaml` (que documenta a API do app de treino); a lista é esta, gerada de `createSaas().routes()`:

| Método | Caminho |
|---|---|
| `GET` | `/api/saas/config` |
| `GET` | `/api/saas/me` |
| `POST` | `/api/saas/gyms` |
| `GET` | `/api/saas/public/gym` |
| `GET` | `/api/saas/public/domain-check` |
| `POST` | `/api/saas/public/join/:slug` |
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
| `GET` | `/api/saas/gyms/:gymId/access/devices` |
| `POST` | `/api/saas/gyms/:gymId/access/devices` |
| `PUT` | `/api/saas/gyms/:gymId/access/devices/:deviceId` |
| `POST` | `/api/saas/gyms/:gymId/access/devices/:deviceId/token` |
| `POST` | `/api/saas/gyms/:gymId/access/devices/:deviceId/release` |
| `POST` | `/api/saas/gyms/:gymId/access/devices/:deviceId/sync` |
| `POST` | `/api/saas/gyms/:gymId/members/:memberId/enroll` |
| `PUT` | `/api/saas/gyms/:gymId/members/:memberId/card` |
| `POST` | `/api/saas/gyms/:gymId/access/checkin` |
| `GET` | `/api/saas/gyms/:gymId/access/logs` |
| `GET` | `/api/saas/gyms/:gymId/access/devices/:deviceId/commands` |
| `POST` | `/api/saas/gyms/:gymId/access/devices/:deviceId/commands/clear` |
| `POST` | `/api/saas/access/check` |

Caminhos dos equipamentos Control iD, na raiz do servidor (`api/saas/device-gateway.js`): `POST /new_user_identified.fcgi`, `POST /new_card.fcgi`, `POST /new_user_id_and_password.fcgi`, `POST /device_is_alive.fcgi`, `GET /push`, `POST /result`.

## O que fica para depois

- Gateway de pagamento real (PIX com QR, boleto, cartão recorrente): hoje a baixa é manual.
- Contas bancárias/caixas separados no financeiro (hoje: categoria + forma de pagamento).
- Traduzir a área de gestão para os outros idiomas do app.
- Apps Android/iOS: identificadores de pacote, ícones e nome nas lojas ainda são os do openGym.
- O site `website/` é o do projeto original.
- Biblioteca de exercícios própria, quando vocês montarem a de vocês (o catálogo fica em `catalogue/`).
