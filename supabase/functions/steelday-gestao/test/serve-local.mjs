// Local stack for trying the screens: PGlite with the schema and a few profiles, and the function
// under Deno on :8000 (test sign-in: bearer "test:<profile id>"). Ctrl+C to stop.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDb } from './local-db.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))
const db = await startDb(55440)
await db.db.exec(`insert into opengym.profiles (id, name, email, admin, owner) values
  ('00000000-0000-4000-8000-000000000003', 'Carlos Personal', 'carlos@example.com', false, false),
  ('00000000-0000-4000-8000-000000000006', 'Bia Souza', 'bia@example.com', false, false)`)
const fn = spawn(process.env.DENO || 'deno', ['run', '-A', '--node-modules-dir=none', path.join(here, '..', 'index.ts')], {
  env: { ...process.env, SUPABASE_DB_URL: 'postgres://postgres:postgres@127.0.0.1:55440/postgres', GESTAO_TEST_AUTH: '1', PG_MAX: '1', SUPABASE_URL: '' }, stdio: 'inherit' })
process.on('SIGTERM', () => { fn.kill(); process.exit(0) })
