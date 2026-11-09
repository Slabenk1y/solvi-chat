'use strict';

require('dotenv').config();
const readline = require('node:readline');
const crypto = require('node:crypto');

let rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = prompt => new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));

function askHidden(prompt) {
  return new Promise(resolve => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      rl.question(prompt, answer => resolve(answer));
      return;
    }
    // Close readline before raw input: otherwise both listeners consume the password.
    rl.close();
    process.stdout.write(prompt);
    let value = '';
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      resolve(value);
    };
    const onData = chunk => {
      for (const char of String(chunk)) {
        if (char === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

const color = {
  reset: '\x1b[0m', cyan: '\x1b[36m', purple: '\x1b[35m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m'
};
function out(message = '') { process.stdout.write(`${message}\n`); }
function banner() {
  out(`${color.purple}${color.bold}╔══════════════════════════════════════════════════════════════╗${color.reset}`);
  out(`${color.purple}${color.bold}║                 S O V L I  ·  OWNER CONSOLE                 ║${color.reset}`);
  out(`${color.purple}${color.bold}╚══════════════════════════════════════════════════════════════╝${color.reset}`);
  out(`${color.dim}Локальная консоль владельца · API защищён серверной ролью${color.reset}\n`);
}
function printJson(title, data) {
  out(`\n${color.cyan}${title}${color.reset}`);
  out(JSON.stringify(data, null, 2));
}

async function main() {
  banner();
  const defaultUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const base = (await ask(`Адрес сервера [${defaultUrl}]: `) || defaultUrl).replace(/\/$/, '');
  const username = await ask('Ник владельца: ');
  const password = await askHidden('Пароль (ввод скрыт): ');
  const accessCode = await ask('Код приглашения (Enter — если не нужен): ');

  let token = '';
  try {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, accessCode })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    token = body.token;
    const overviewResponse = await fetch(`${base}/api/admin/overview`, { headers: { authorization: `Bearer ${token}` } });
    const overview = await overviewResponse.json().catch(() => ({}));
    if (!overviewResponse.ok) {
      if (overviewResponse.status === 403) throw new Error('Аккаунт не назначен владельцем. Укажи его public ID в OWNER_PUBLIC_ID внутри .env и перезапусти SOVLI. Public ID виден в профиле.');
      throw new Error(overview.error || `HTTP ${overviewResponse.status}`);
    }
    out(`${color.green}✓ Авторизация владельца подтверждена.${color.reset}`);
    out(`Пользователей: ${overview.users} · Активных диалогов: ${overview.activeMatches} · Открытых жалоб: ${overview.openReports}\n`);
  } catch (error) {
    out(`${color.red}[ОШИБКА] ${error.message}${color.reset}`);
    rl.close();
    process.exitCode = 1;
    return;
  }

  async function api(path, method = 'GET', payload) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
  async function guarded(label, fn) {
    try { const result = await fn(); if (result !== undefined) printJson(label, result); }
    catch (error) { out(`${color.red}Ошибка: ${error.message}${color.reset}`); }
    await ask('\nEnter — продолжить…');
  }
  function menu() {
    out(`${color.cyan}${color.bold}УПРАВЛЕНИЕ${color.reset}`);
    out(' 1  Сводка и экономика');
    out(' 2  Пользователи: поиск и список');
    out(' 3  Начислить / списать токены');
    out(' 4  Создать промокод');
    out(' 5  Просмотреть / отключить промокоды');
    out(' 6  Активные диалоги');
    out(' 7  Завершить диалог');
    out(' 8  Изменить цену или наличие товара');
    out(' 9  Выдать / снять VIP или Premium');
    out('10  Назначить роль');
    out('11  Временно ограничить пользователя');
    out('12  Просмотреть жалобы');
    out('13  Журнал действий владельца');
    out('14  Завершить все сессии пользователя');
    out('15  Закрыть жалобу');
    out(' q  Выход\n');
  }

  while (true) {
    menu();
    const choice = (await ask('Выбери действие: ')).toLowerCase();
    if (choice === 'q' || choice === 'й') break;
    if (choice === '1') await guarded('Сводка и экономика', async () => ({ overview: await api('/api/admin/overview'), economy: await api('/api/admin/economy') }));
    else if (choice === '2') await guarded('Пользователи', async () => {
      const q = await ask('Ник или public ID (Enter — последние 50): ');
      return api(`/api/admin/users?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    });
    else if (choice === '3') await guarded('Баланс пользователя', async () => {
      const id = await ask('Внутренний ID пользователя: ');
      const amount = Number(await ask('Количество токенов (+ начислить / - списать): '));
      const reason = await ask('Причина для журнала: ');
      return api(`/api/admin/users/${encodeURIComponent(id)}/tokens`, 'POST', { amount, reason });
    });
    else if (choice === '4') await guarded('Промокод создан', async () => {
      const supplied = (await ask('Код (Enter — сгенерировать): ')).toUpperCase();
      const code = supplied || `SOV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const tokens = Number(await ask('Награда токенами [0]: ')) || 0;
      const itemId = await ask('ID предмета (Enter — без предмета): ');
      const tierInput = (await ask('Привилегия: нет / vip / premium [нет]: ')).toLowerCase();
      const membershipTier = ['vip', 'premium'].includes(tierInput) ? tierInput : undefined;
      const membershipDays = membershipTier ? Number(await ask('Срок в днях (1 / 7 / 30 / 90): ')) : undefined;
      const maxUses = Number(await ask('Максимум активаций [1]: ')) || 1;
      const expires = await ask('Дата окончания ISO (Enter — без срока): ');
      return api('/api/admin/promos', 'POST', { code, tokens, itemId: itemId || undefined, membershipTier, membershipDays, maxUses, expiresAt: expires || undefined });
    });
    else if (choice === '5') await guarded('Промокоды', async () => {
      const result = await api('/api/admin/promos');
      printJson('Список промокодов', result);
      const id = await ask('ID промокода для включения/отключения (Enter — назад): ');
      if (!id) return;
      const active = (await ask('Включить? (y/n): ')).toLowerCase() === 'y';
      return api(`/api/admin/promos/${encodeURIComponent(id)}`, 'PATCH', { active });
    });
    else if (choice === '6') await guarded('Активные диалоги (только метаданные)', () => api('/api/admin/matches'));
    else if (choice === '7') await guarded('Диалог завершён', async () => {
      const id = await ask('ID активного диалога: ');
      const reason = await ask('Причина (Enter — проверка владельца): ');
      return api(`/api/admin/matches/${encodeURIComponent(id)}/end`, 'POST', { reason });
    });
    else if (choice === '8') await guarded('Цена товара обновлена', async () => {
      const id = await ask('ID товара из каталога: ');
      const price = Number(await ask('Новая цена в токенах: '));
      const enabled = (await ask('Оставить товар в продаже? (y/n): ')).toLowerCase() !== 'n';
      return api(`/api/admin/store/${encodeURIComponent(id)}/price`, 'PATCH', { price, enabled });
    });
    else if (choice === '9') await guarded('Привилегия пользователя обновлена', async () => {
      const id = await ask('Внутренний ID пользователя: ');
      const tier = (await ask('Статус: vip / premium / free: ')).toLowerCase();
      const days = tier === 'free' ? undefined : Number(await ask('Срок: 1 / 7 / 30 / 90 дней: '));
      return api(`/api/admin/users/${encodeURIComponent(id)}/membership`, 'POST', { tier, days });
    });
    else if (choice === '10') await guarded('Роль обновлена', async () => {
      const id = await ask('Внутренний ID пользователя: ');
      const role = (await ask('Роль: member / moderator / developer: ')).toLowerCase();
      return api(`/api/admin/users/${encodeURIComponent(id)}/role`, 'POST', { role });
    });
    else if (choice === '11') await guarded('Доступ ограничен', async () => {
      const id = await ask('Внутренний ID пользователя: ');
      const minutes = Number(await ask('Срок: 10 / 60 / 1440 / 10080 минут: '));
      const reason = await ask('Причина: ');
      return api(`/api/admin/users/${encodeURIComponent(id)}/suspend`, 'POST', { minutes, reason });
    });
    else if (choice === '12') await guarded('Жалобы', () => api('/api/admin/reports'));
    else if (choice === '13') await guarded('Журнал действий', () => api('/api/admin/audit'));
    else if (choice === '14') await guarded('Сессии пользователя отозваны', async () => {
      const id = await ask('Внутренний ID пользователя: ');
      if ((await ask('Отозвать все сессии этого пользователя? (y/n): ')).toLowerCase() !== 'y') return;
      return api(`/api/admin/users/${encodeURIComponent(id)}/logout`, 'POST', {});
    });
    else if (choice === '15') await guarded('Жалоба закрыта', async () => {
      const id = await ask('ID жалобы: ');
      const resolution = await ask('Комментарий о решении: ');
      return api(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, 'POST', { resolution });
    });
    else { out(`${color.yellow}Неизвестная команда.${color.reset}`); await ask('Enter — продолжить…'); }
    out('');
  }

  rl.close();
  out(`${color.green}Консоль владельца закрыта. Хорошего дня!${color.reset}`);
}

main().catch(error => { console.error('[OWNER CONSOLE]', error); rl.close(); process.exitCode = 1; });
