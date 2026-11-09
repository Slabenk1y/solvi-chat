'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { captureSnapshot, restoreSnapshot } = require('../lib/postgres-snapshot.cjs');

function createDatabase(sql) {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  return db;
}

test('snapshot restores account data and dependent rows even when SQLite columns changed', () => {
  const source = createDatabase(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, legacy_note TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT);
    INSERT INTO users VALUES ('u1', 'SovliOwner', 'legacy');
    INSERT INTO sessions VALUES ('s1', 'u1', '2026-01-01T00:00:00.000Z');
  `);
  const target = createDatabase(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT);
  `);

  const snapshot = captureSnapshot(source, { appVersion: '1.3.0' });
  const result = restoreSnapshot(target, snapshot);

  assert.equal(result.rowCount, 2);
  assert.deepEqual({ ...target.prepare('SELECT id, username, role FROM users').get() }, {
    id: 'u1',
    username: 'SovliOwner',
    role: 'member'
  });
  assert.deepEqual({ ...target.prepare('SELECT id, user_id FROM sessions').get() }, {
    id: 's1',
    user_id: 'u1'
  });
  source.close();
  target.close();
});

test('snapshot includes and restores avatar files', t => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-avatar-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-avatar-target-'));
  t.after(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(sourceDir, 'avatar-u1.png'), Buffer.from([0, 1, 2, 3, 255]));
  fs.writeFileSync(path.join(targetDir, 'old-file.png'), 'stale');

  const source = createDatabase(`
    CREATE TABLE users (id TEXT PRIMARY KEY, avatar_file TEXT, avatar_mime TEXT);
    INSERT INTO users VALUES ('u1', 'avatar-u1.png', 'image/png');
  `);
  const target = createDatabase('CREATE TABLE users (id TEXT PRIMARY KEY, avatar_file TEXT, avatar_mime TEXT);');

  const snapshot = captureSnapshot(source, { avatarDir: sourceDir });
  restoreSnapshot(target, snapshot, { avatarDir: targetDir });

  assert.deepEqual(fs.readFileSync(path.join(targetDir, 'avatar-u1.png')), Buffer.from([0, 1, 2, 3, 255]));
  assert.equal(fs.existsSync(path.join(targetDir, 'old-file.png')), false);
  assert.equal(target.prepare('SELECT avatar_file FROM users WHERE id = ?').get('u1').avatar_file, 'avatar-u1.png');
  source.close();
  target.close();
});

test('missing avatar assets are detached from restored accounts instead of returning broken URLs', () => {
  const db = createDatabase(`
    CREATE TABLE users (id TEXT PRIMARY KEY, avatar_file TEXT, avatar_mime TEXT);
    INSERT INTO users VALUES ('u1', 'not-backed-up.png', 'image/png');
  `);
  const snapshot = {
    format: 1,
    savedAt: new Date().toISOString(),
    tables: { users: [{ id: 'u1', avatar_file: 'not-backed-up.png', avatar_mime: 'image/png' }] },
    avatars: []
  };

  restoreSnapshot(db, snapshot);
  assert.deepEqual({ ...db.prepare('SELECT avatar_file, avatar_mime FROM users').get() }, {
    avatar_file: null,
    avatar_mime: null
  });
  db.close();
});
