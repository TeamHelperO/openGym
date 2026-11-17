/* The SaaS store: one SQLite file (DATA_DIR/saas.db) through Node's built-in node:sqlite, so the
 * api keeps its three dependencies. Opened on first use, so an instance (or a test) that never
 * touches /api/saas/* never creates the file.
 *
 * Every table that belongs to an academy carries gym_id, and every query in the route modules
 * filters on it: that column is the tenant boundary. Money is integer cents, dates are
 * 'YYYY-MM-DD' strings, timestamps are ISO strings. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MIGRATIONS } from './migrations.js';

let sqlite = null;
async function loadSqlite() {
  if (sqlite) return sqlite;
  // node:sqlite prints an ExperimentalWarning once on load; it says nothing an operator can act on.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => {
    const msg = typeof w === 'string' ? w : w?.message || '';
    if (/SQLite is an experimental feature/.test(msg)) return;
    return emit.call(process, w, ...rest);
  };
  try { sqlite = await import('node:sqlite'); }
  finally { process.emitWarning = emit; }
  return sqlite;
}
await loadSqlite();

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

let current = null;
let currentFile = null;

/** The open database for `dataDir`, migrated to the latest schema. */
export function openDb(dataDir) {
  const file = dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'saas.db');
  if (current && currentFile === file) return current;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  }
  migrate(db);
  current = db; currentFile = file;
  return db;
}

export function closeDb() {
  if (current) { try { current.close(); } catch { /* already closed */ } }
  current = null; currentFile = null;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
    });
    version = i + 1;
  }
}

/** Run `fn` in one transaction: everything it writes lands together or not at all. */
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* the error below is the one that matters */ }
    throw e;
  }
}
