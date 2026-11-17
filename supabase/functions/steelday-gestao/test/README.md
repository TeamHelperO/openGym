# Testes da função steelday-gestao

Rodam a função de verdade (Deno, o mesmo runtime do Supabase) contra um Postgres local (PGlite)
com o mesmo esquema. Não tocam no Supabase.

```bash
mkdir -p /tmp/gestao-tools && cd /tmp/gestao-tools && npm init -y && npm i deno @electric-sql/pglite @electric-sql/pglite-socket
cd <repo>/supabase/functions/steelday-gestao/test
ln -s /tmp/gestao-tools/node_modules node_modules   # ESM resolves packages beside the file
DENO=/tmp/gestao-tools/node_modules/.bin/deno node --test api.test.mjs
```
