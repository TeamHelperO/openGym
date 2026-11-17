// A local Postgres for the function's tests: PGlite (Postgres in WebAssembly) behind a socket,
// with the parts of the opengym schema this function reads (profiles, state) and the gestão
// migration. Needs @electric-sql/pglite and @electric-sql/pglite-socket (see test/README.md).
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrations = ['20261117190000_gestao.sql', '20261117200000_gestao_personal.sql'].map(f => path.join(here, '../../../migrations', f))

export async function startDb(port) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema opengym;
    create table opengym.profiles (id uuid primary key, name text not null, email text, admin boolean not null default false,
      owner boolean not null default false, disabled boolean not null default false, created_at timestamptz not null default now());
    create table opengym.state (user_id uuid primary key references opengym.profiles(id) on delete cascade, doc jsonb not null default '{}'::jsonb,
      rev integer not null default 0, updated_at timestamptz not null default now());`)
  for (const m of migrations) await db.exec(fs.readFileSync(m, 'utf8'))
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 1 })
  await server.start()
  return { db, stop: async () => { await server.stop(); await db.close() } }
}
