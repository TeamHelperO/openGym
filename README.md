# FitHub Gestão

Plataforma SaaS de gestão de academias com app de treino para alunos.

Cada academia se cadastra com o próprio nome e logo e administra, no mesmo sistema:

- **Pessoas:** alunos, instrutores e administradores, com acesso por código de convite.
- **Treino:** o instrutor monta fichas com a biblioteca de exercícios e atribui aos alunos. O aluno recebe a ficha no app e treina por ele.
- **Financeiro:** planos, mensalidades, cobranças, entradas e saídas, fluxo de caixa por categoria e forma de pagamento.
- **Insumos e compras:** material de limpeza e de consumo, fornecedores e pedidos de compra. Receber um pedido atualiza o estoque e lança a despesa.
- **PDV / loja:** venda de água, suplementos e outros produtos, com caixa (abertura, sangria, suprimento e fechamento), estoque e venda fiado na conta do aluno.
- **Administração da plataforma:** todas as academias (suspender e reativar) e todos os usuários (bloquear, dar papel de administrador, código de recuperação).

Detalhes de arquitetura, papéis, rotas e configuração: [docs/SAAS.md](docs/SAAS.md).

## Como rodar

```bash
cp .env.example .env
docker compose up -d --build
```

Depois abra `http://localhost:8080`, crie a conta e entre em **Gestão da academia** (ícone de casa no topo da tela inicial, ou em Configurações). O primeiro perfil criado vira administrador da plataforma quando `FIRST_USER_ADMIN` está ligado, ou defina `ADMIN_UIDS` no `.env` (veja `docs/SELF_HOSTING.md`).

Para desenvolvimento:

```bash
cd api && npm install && DATA_DIR=./data ORIGIN=http://localhost:5173 RP_ID=localhost node server.js
cd frontend && npm install && npm run dev
```

Testes: `cd api && npm test` e `cd frontend && npm test`.

## Licença e créditos

Este sistema é um fork do [openGym](https://github.com/DuarteSantos8/openGym), de Duarte Santos, e continua sob a **GNU AGPL-3.0** ([LICENSE](LICENSE)). Isso significa, entre outras coisas, que quem usa o sistema pela internet tem direito ao código-fonte desta versão: o rodapé da área de gestão aponta para ele (variável `SOURCE_URL`).

- Avisos de terceiros (MuscleMap, ExerciseDB, bibliotecas): [NOTICE.md](NOTICE.md).
- **Fotos e animações dos exercícios** são licenciadas pela Gym visual só para o openGym. Um uso comercial precisa de licença própria em [gymvisual.com](https://gymvisual.com). Por isso o build sai sem elas (`EXERCISE_MEDIA=off`); os nomes, músculos e instruções dos exercícios continuam disponíveis.
- O README original do openGym está em [docs/OPENGYM_README.md](docs/OPENGYM_README.md).
