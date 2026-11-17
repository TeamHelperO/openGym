/* saas.db upgrades in place: a file made by an earlier version gets the new schema and its people
   get turnstile numbers, one academy at a time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../saas/migrations.js';
import { openDb, closeDb } from '../saas/db.js';

test('a version-1 file migrates and numbers existing people per academy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-db-'));
  const raw = new DatabaseSync(path.join(dir, 'saas.db'));
  raw.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
  raw.exec(MIGRATIONS[0]);
  raw.exec('INSERT INTO schema_version VALUES (1)');
  const now = new Date().toISOString();
  for (const g of ['g1', 'g2']) raw.prepare("INSERT INTO gyms (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run(g, g, g, now);
  const m = raw.prepare("INSERT INTO memberships (id, gym_id, role, name, created_at, updated_at) VALUES (?, ?, 'student', ?, ?, ?)");
  m.run('a', 'g1', 'A', now, now); m.run('b', 'g2', 'B', now, now); m.run('c', 'g1', 'C', now, now);
  raw.close();

  const db = openDb(dir);
  assert.equal(db.prepare('SELECT version FROM schema_version').get().version, MIGRATIONS.length);
  const ids = Object.fromEntries(db.prepare('SELECT id, access_id FROM memberships').all().map(r => [r.id, r.access_id]));
  assert.deepEqual(ids, { a: 1001, b: 1001, c: 1002 });
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'access_devices'").get());
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
