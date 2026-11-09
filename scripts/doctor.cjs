'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

function line(ok, message) {
  process.stdout.write(`${ok ? '[OK]' : '[FAIL]'} ${message}\n`);
}

async function main() {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const rawLine of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      const value = match[2].replace(/^(["'])(.*)\1$/, '$2');
      process.env[match[1]] = value;
    }
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 16);
  line(nodeOk, `Node.js ${process.version} (требуется 22.16+)`);
  if (!nodeOk) process.exitCode = 1;

  try {
    const sqlite = require('node:sqlite');
    const SqliteDatabase = sqlite.Database || sqlite.DatabaseSync;
    const file = path.join(os.tmpdir(), `sovli-doctor-${process.pid}-${Date.now()}.sqlite`);
    const db = new SqliteDatabase(file);
    db.exec('CREATE TABLE checkup (value TEXT NOT NULL)');
    db.prepare('INSERT INTO checkup (value) VALUES (?)').run('ok');
    const result = db.prepare('SELECT value FROM checkup').get();
    db.close();
    fs.rmSync(file, { force: true });
    line(result?.value === 'ok', `Встроенная SQLite доступна (${process.versions.sqlite || 'версия встроенного модуля'})`);
    if (result?.value !== 'ok') process.exitCode = 1;
  } catch (error) {
    line(false, `Встроенная SQLite недоступна: ${error.message}`);
    process.exitCode = 1;
  }

  const required = ['express', 'socket.io', 'bcryptjs', 'jsonwebtoken', 'express-rate-limit', 'helmet', 'dotenv'];
  for (const name of required) {
    try { require.resolve(name); line(true, `Пакет ${name}`); }
    catch { line(false, `Не найден пакет ${name}. Выполни npm install.`); process.exitCode = 1; }
  }

  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    const legacyDbPath = path.join(dataDir, 'orbit.sqlite');
    if (fs.existsSync(legacyDbPath)) {
      const sqlite = require('node:sqlite');
      const SqliteDatabase = sqlite.Database || sqlite.DatabaseSync;
      const existingDb = new SqliteDatabase(legacyDbPath);
      const integrity = existingDb.prepare('PRAGMA integrity_check').get();
      existingDb.close();
      if (integrity?.integrity_check !== 'ok') throw new Error(`SQLite integrity_check: ${integrity?.integrity_check || 'no result'}`);
      line(true, 'Существующая data/orbit.sqlite открывается и проходит integrity_check');
    }
    line(true, `Папка данных доступна для записи: ${dataDir}`);
  } catch (error) {
    line(false, `Нет доступа к папке данных ${dataDir}: ${error.message}`);
    process.exitCode = 1;
  }

  const port = Number(process.env.PORT || 3000);
  if (Number.isInteger(port) && port > 0 && port < 65536) {
    const probe = net.createServer();
    const available = await new Promise(resolve => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
    });
    line(available, available ? `Порт ${port} свободен` : `Порт ${port} уже занят. Закрой старый сервер или выбери другой.`);
    if (!available) process.exitCode = 1;
  }

  if (process.exitCode) {
    process.stdout.write('\n[FAIL] Проверка не пройдена. Исправь строки выше и запусти start.bat ещё раз.\n');
  } else {
    process.stdout.write('\n[OK] Проверка завершена. SOVLI готов к запуску.\n');
  }
}

main().catch(error => {
  console.error('[FAIL] Ошибка диагностики:', error.stack || error);
  process.exitCode = 1;
});
