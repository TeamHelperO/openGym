# SteelDay (personal trainers) e o white label das academias

Um código e um servidor, dois produtos:

| Produto | Para quem | Build |
|---|---|---|
| **SteelDay** (steelday.vercel.app) | Personal trainers e seus alunos | padrão (`VITE_PRODUCT` vazio ou `personal`) |
| **White label** | Academias, cada uma com sua marca (logo, cores, link, domínio) | `VITE_PRODUCT=academia`, em outro projeto da Vercel |

Cada espaço guarda o seu tipo (`opengym.gyms.kind`: `personal` ou `academy`) e o menu segue esse tipo.

## Personal trainer (SteelDay)

- Quem cria a conta direto no SteelDay cai em "Sou personal trainer" e cria a consultoria.
- **Aluno por e-mail**: o personal cadastra o aluno com e-mail e o sistema manda o convite do
  Supabase Auth; o aluno define a senha pelo link e, ao entrar, já aparece ligado ao personal (a
  ligação é pelo e-mail confirmado). Quem já tem conta é ligado na próxima entrada.
  Atenção: o e-mail padrão do Supabase envia poucos e-mails por hora. Para uso real, configure um
  SMTP próprio em Authentication > Emails no painel do Supabase.
- **Avaliação física**: peso, altura, 16 perímetros e bioimpedância (% de gordura, massa magra,
  água, visceral...), com IMC, relação cintura/quadril, gráficos e comparação primeira x última.
- **Nutrição**: plano alimentar montado com a tabela TACO (Unicamp, 597 alimentos, calorias e macros
  por 100 g; `frontend/src/saas/lib/taco.js`), metas do dia, orientações. O aluno marca as refeições,
  comenta e manda foto do prato; o personal vê o diário e a adesão dos últimos 7 dias.
- **Musculação**: fichas de treino atribuídas, que o aluno adiciona ao plano do app.
- **Cobrança**: planos, mensalidades e atrasos (sem pagamento automático por enquanto).

## White label das academias

Tudo do personal mais equipe, PDV, insumos, catracas, link de cadastro e domínio próprio. Para
publicar separado: crie outro projeto na Vercel com o mesmo repositório, Root Directory
`frontend`, e as variáveis `VITE_PRODUCT=academia`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY`.


A área de gestão (`/#/gestao`) roda no mesmo Supabase do app:

| Parte | Onde |
|---|---|
| Telas | `frontend/src/saas/` (pt-BR, layout largo com menu lateral) |
| Servidor | Edge Function `steelday-gestao` (`supabase/functions/steelday-gestao/`), ao lado da `opengym-api` |
| Banco | tabelas `opengym.gyms` e `opengym.gym_*` (`supabase/migrations/20261117190000_gestao.sql` e `20261117200000_gestao_personal.sql`), RLS ligado e sem grants: só as funções acessam |
| Contas | as mesmas do app (Supabase Auth + `opengym.profiles`). A primeira conta é dona da plataforma |

As telas chamam a função com o token do usuário (`frontend/src/saas/api.js`, `GESTAO_BASE` em
`lib/supa-auth.js`). Bloquear usuário, dar papel de admin e código de recuperação continuam nas rotas
`/api/admin/*` da `opengym-api`.

## O que tem

Academias (nome, logo, cor, CNPJ, domínio próprio, link de cadastro com QR), alunos, instrutores e
administradores (código de convite ou cadastro pelo link), fichas de treino que o aluno adiciona ao
plano do app, mensalidades e financeiro, insumos e compras, PDV com caixa, catracas e o painel da
plataforma com todas as academias e usuários.

## Catracas

- **Control iD** (iDBlock, iDAccess, iDFace...): o equipamento identifica a digital e pergunta ao
  servidor (`/new_user_identified.fcgi`); o servidor responde liberando o giro (`event: 7`, ação
  `catra`) ou negando com o motivo (`event: 6`). No modo push (`/push`, `/result`) o servidor manda
  comandos: enviar alunos, cadastrar digital, girar pela recepção. Formatos dos exemplos oficiais
  ([controlid/integracao](https://github.com/controlid/integracao)).
- O equipamento recebe só host e porta, então `frontend/vercel.json` reescreve esses caminhos da
  raiz do site para a função. O equipamento precisa falar HTTPS (porta 443).
- **Proteção da Vercel**: com "Vercel Authentication" ligada para o domínio `*.vercel.app`, os
  equipamentos recebem a tela de login da Vercel. Use um domínio próprio (fica fora da proteção) ou
  desligue a proteção do domínio de produção.
- **Outras marcas**: `POST /functions/v1/steelday-gestao/api/saas/access/check` com o token do
  equipamento.
- Ainda não testado com equipamento físico.

## Publicar

```bash
supabase db push                                   # a migração das tabelas gym_*
supabase functions deploy steelday-gestao --no-verify-jwt
```

A função não usa o verificador de JWT da plataforma: ela mesma confere o token (as catracas chamam
sem token). Testes locais: `supabase/functions/steelday-gestao/test/README.md`.
