'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const SNAPSHOT_FORMAT = 1;
const MAX_AVATAR_FILE_BYTES = 2 * 1024 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AVATAR_FILENAME = /^[A-Za-z0-9._-]{1,200}$/;

function quoteIdentifier(value) {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new Error('Unsafe SQLite identifier in persistent snapshot.');
  }
  return '"' + value + '"';
}

function listTables(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(row => row.name);
}

function captureSnapshot(db, options = {}) {
  const tables = {};
  for (const table of listTables(db)) {
    tables[table] = db.prepare('SELECT * FROM ' + quoteIdentifier(table)).all();
  }

  return {
    format: SNAPSHOT_FORMAT,
    appVersion: String(options.appVersion || ''),
    savedAt: new Date().toISOString(),
    tables,
    stats: {
      tableCount: Object.keys(tables).length,
      rowCount: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0)
    }
  };
}

function restoreAvatarFiles(rows, avatarDir) {
  if (!avatarDir) return new Set();
  fs.mkdirSync(avatarDir, { recursive: true });

  for (const entry of fs.readdirSync(avatarDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      try { fs.unlinkSync(path.join(avatarDir, entry.name)); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  const names = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.name !== 'string' || !AVATAR_FILENAME.test(row.name)) continue;
    const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || '');
    if (data.length > MAX_AVATAR_FILE_BYTES) continue;
    fs.writeFileSync(path.join(avatarDir, row.name), data, { mode: 0o600 });
    names.add(row.name);
  }
  return names;
}

function restoreSnapshot(db, snapshot, options = {}) {
  if (!snapshot || snapshot.format !== SNAPSHOT_FORMAT || !snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) {
    throw new Error('Neon snapshot is missing or has an unsupported format.');
  }

  const currentTables = listTables(db);
  const currentSet = new Set(currentTables);
  const validColumns = new Map();
  for (const table of currentTables) {
    validColumns.set(table, new Set(
      db.prepare('PRAGMA table_info(' + quoteIdentifier(table) + ')').all().map(column => column.name)
    ));
  }

  let transactionOpen = false;
  try {
    db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
    transactionOpen = true;

    for (const table of [...currentTables].reverse()) {
      db.exec('DELETE FROM ' + quoteIdentifier(table));
    }

    for (const [table, rows] of Object.entries(snapshot.tables)) {
      if (!currentSet.has(table) || !Array.isArray(rows)) continue;
      const knownColumns = validColumns.get(table);
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const entries = Object.entries(row).filter(([column]) => knownColumns.has(column));
        if (!entries.length) continue;
        const columns = entries.map(([column]) => quoteIdentifier(column)).join(', ');
        const placeholders = entries.map(() => '?').join(', ');
        const values = entries.map(([, value]) => value === undefined ? null : value);
        db.prepare('INSERT INTO ' + quoteIdentifier(table) + ' (' + columns + ') VALUES (' + placeholders + ')').run(...values);
      }
    }

    if (options.avatarNames instanceof Set && currentSet.has('users')) {
      const updateMissingAvatar = db.prepare('UPDATE users SET avatar_file = NULL, avatar_mime = NULL WHERE id = ?');
      const users = db.prepare('SELECT id, avatar_file FROM users WHERE avatar_file IS NOT NULL').all();
      for (const user of users) {
        if (!options.avatarNames.has(user.avatar_file)) updateMissingAvatar.run(user.id);
      }
    }

    db.exec('COMMIT;');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec('ROLLBACK;'); } catch { /* preserve original error */ }
    }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  return {
    tableCount: Object.keys(snapshot.tables).length,
    rowCount: Object.values(snapshot.tables).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0),
    savedAt: snapshot.savedAt || null
  };
}

class PostgresSnapshotStore {
  constructor(options = {}) {
    if (!options.connectionString) throw new Error('DATABASE_URL is required for persistent Neon storage.');
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      application_name: 'sovli-chat'
    });
    this.avatarDir = options.avatarDir || null;
    this.appVersion = options.appVersion || '';
    this.ready = false;
    this.avatarFingerprints = new Map();
    this.remoteAvatarNames = new Set();
    this.pool.on('error', error => {
      console.error('[SOVLI] Ошибка фонового соединения с Neon:', error.message);
    });
  }

  async initialize(db) {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sovli_persistent_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sovli_avatar_files (
        name TEXT PRIMARY KEY,
        data BYTEA NOT NULL,
        size INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const result = await this.pool.query(
      'SELECT payload, updated_at FROM sovli_persistent_state WHERE id = 1'
    );
    if (result.rows.length) {
      const avatarRows = await this.pool.query('SELECT name, data, size FROM sovli_avatar_files');
      const avatarNames = restoreAvatarFiles(avatarRows.rows, this.avatarDir);
      this.refreshAvatarFingerprints(avatarNames);
      const restored = restoreSnapshot(db, result.rows[0].payload, { avatarNames });
      this.ready = true;
      return { restored: true, ...restored, avatarCount: avatarNames.size, updatedAt: result.rows[0].updated_at };
    }

    const seeded = await this.save(db);
    this.ready = true;
    return { restored: false, ...seeded, updatedAt: new Date().toISOString() };
  }

  refreshAvatarFingerprints(names) {
    this.avatarFingerprints.clear();
    this.remoteAvatarNames = new Set(names);
    if (!this.avatarDir) return;
    for (const name of names) {
      const filePath = path.join(this.avatarDir, name);
      try {
        const stat = fs.statSync(filePath);
        this.avatarFingerprints.set(name, `${stat.size}:${stat.mtimeMs}`);
      } catch { /* missing local file will be re-uploaded or removed on next save */ }
    }
  }

  async syncAvatarFiles() {
    const currentNames = new Set();
    let count = 0;
    let bytes = 0;
    if (this.avatarDir && fs.existsSync(this.avatarDir)) {
      for (const entry of fs.readdirSync(this.avatarDir, { withFileTypes: true })) {
        if (!entry.isFile() || !AVATAR_FILENAME.test(entry.name)) continue;
        const filePath = path.join(this.avatarDir, entry.name);
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_AVATAR_FILE_BYTES) continue;
        currentNames.add(entry.name);
        const fingerprint = `${stat.size}:${stat.mtimeMs}`;
        if (this.avatarFingerprints.get(entry.name) !== fingerprint) {
          const data = fs.readFileSync(filePath);
          await this.pool.query(
            `INSERT INTO sovli_avatar_files (name, data, size, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, size = EXCLUDED.size, updated_at = EXCLUDED.updated_at`,
            [entry.name, data, data.length]
          );
          this.avatarFingerprints.set(entry.name, fingerprint);
          this.remoteAvatarNames.add(entry.name);
        }
        count += 1;
        bytes += stat.size;
      }
    }

    for (const oldName of [...this.remoteAvatarNames]) {
      if (currentNames.has(oldName)) continue;
      await this.pool.query('DELETE FROM sovli_avatar_files WHERE name = $1', [oldName]);
      this.remoteAvatarNames.delete(oldName);
      this.avatarFingerprints.delete(oldName);
    }
    return { count, bytes };
  }

  async save(db) {
    const payload = captureSnapshot(db, { appVersion: this.appVersion });
    await this.pool.query(
      `INSERT INTO sovli_persistent_state (id, payload, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(payload)]
    );
    const avatars = await this.syncAvatarFiles();
    return { ...payload.stats, avatarCount: avatars.count, avatarBytes: avatars.bytes };
  }

  async close() {
    await this.pool.end();
    this.ready = false;
  }
}

module.exports = {
  SNAPSHOT_FORMAT,
  PostgresSnapshotStore,
  captureSnapshot,
  restoreAvatarFiles,
  restoreSnapshot
};
