const { createClient } = require('@libsql/client');

const LIBSQL_URL = process.env.TURSO_URL || 'libsql://kortex-yanikuaite-commits.aws-ap-northeast-1.turso.io';
const LIBSQL_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODk3NjA0NzEsImlkIjoiMDFhMGI2MDctNjAwMS03ZTgyLWIyMTYtMTZiMzY4YTI5ZWJkIiwia2lkIjoiOHdOUVI0WnhOdUtoZVZjQTNRQTBOTVBMa3hxOUdNUFNrRVVLV3lxNHN4QSIsInJpZCI6IjZhMDEzNmNjLWU5ODItNGQzNS1hYjkyLTc5NWQxMTg5MWI4YSJ9.ArqsmZKWo372BlryDfAc4ag3-KYl59y6ZMj-8xghbSS-jeNVrdZ3MKPcAEawZbP2CKScHTcJqJniIEltA7BtBw';

let client = null;
let initialized = false;
let schemaReady = false;

async function ensureSchema() {
  if (!client || schemaReady) return;
  await client.execute(`CREATE TABLE IF NOT EXISTS backup (
    id TEXT PRIMARY KEY,
    payload TEXT,
    atualizadoEm INTEGER
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS stats (
    id TEXT PRIMARY KEY,
    value TEXT,
    atualizadoEm INTEGER
  )`);
  schemaReady = true;
}

try {
  client = createClient({ url: LIBSQL_URL, authToken: LIBSQL_AUTH_TOKEN });
  initialized = true;
  ensureSchema().catch((e) => {
    console.warn('⚠️ Turso: falha ao preparar esquema:', e && e.message ? e.message : e);
  });
} catch (e) {
  console.warn('⚠️ Turso: não foi possível iniciar cliente. O bot continuará em modo local.', e && e.message ? e.message : e);
  client = null;
  initialized = false;
}

const Backup = {
  async salvarTudo(obj) {
    if (!client) return false;
    await ensureSchema();
    const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
    await client.execute({
      sql: 'INSERT INTO backup (id, payload, atualizadoEm) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, atualizadoEm = excluded.atualizadoEm',
      args: ['backup', payload, Date.now()]
    });
    return true;
  },

  async carregarTudo() {
    if (!client) return {};
    await ensureSchema();
    const res = await client.execute({
      sql: 'SELECT payload FROM backup WHERE id = ? LIMIT 1',
      args: ['backup']
    });
    const row = res.rows?.[0];
    const value = row ? row.payload : null;
    if (value === null || value === undefined || value === '') return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) || {};
      } catch (e) {
        return {};
      }
    }
    return value;
  }
};

const Stats = {
  async set(path, value) {
    if (!client || !path) return false;
    await ensureSchema();
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await client.execute({
      sql: 'INSERT INTO stats (id, value, atualizadoEm) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, atualizadoEm = excluded.atualizadoEm',
      args: [String(path), payload, Date.now()]
    });
    return true;
  },

  async getAllStats() {
    if (!client) return {};
    await ensureSchema();
    const res = await client.execute('SELECT id, value FROM stats');
    const obj = {};
    for (const row of res.rows || []) {
      const key = String(row.id);
      const raw = row.value;
      if (raw === null || raw === undefined || raw === '') continue;
      try {
        obj[key] = JSON.parse(raw);
      } catch (e) {
        obj[key] = raw;
      }
    }
    return obj;
  }
};

module.exports = { client, db: client, Backup, Stats, initialized };
