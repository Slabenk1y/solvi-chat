'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: createSocket } = require('socket.io-client');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer(baseUrl, child, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* wait for the listener */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Server did not start before timeout');
}

function waitForEvent(socket, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const handler = payload => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(eventName, handler);
  });
}

async function postJson(baseUrl, route, body, token) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.ok, true, `${route} failed: ${payload.error || response.status}`);
  return payload;
}

test('two accounts find each other and exchange a real Socket.IO message', { timeout: 35_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_MODE: '0', PUBLIC_MATCHING: '1', PUBLIC_TEST_CODE: '', JWT_SECRET: 'test-secret-for-integration-tests-only-1234567890' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const sockets = [];
  let testDb;
  try {
    await waitForServer(baseUrl, child);
    const user1 = await postJson(baseUrl, '/api/auth/register', { username: 'tester-one', password: 'test-password-111' });
    const user2 = await postJson(baseUrl, '/api/auth/register', { username: 'tester-two', password: 'test-password-222' });
    assert.match(user1.user.publicId, /^[A-F0-9]{10}$/);
    assert.match(user2.user.publicId, /^[A-F0-9]{10}$/);
    assert.equal(user1.user.tokens, 0, 'new accounts start with zero tokens');
    assert.equal(user2.user.tokens, 0, 'new accounts start with zero tokens');
    testDb = new DatabaseSync(path.join(dataDir, 'orbit.sqlite'));
    testDb.prepare('UPDATE users SET tokens = 1000 WHERE id IN (?, ?)').run(user1.user.id, user2.user.id);
    const loginCheck = await postJson(baseUrl, '/api/auth/login', { username: 'TESTER-ONE', password: 'test-password-111' });
    assert.equal(loginCheck.user.id, user1.user.id);
    const sessionList = await (await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${user1.token}` } })).json();
    assert.ok(sessionList.sessions.some(session => session.current), 'current session must be identified');
    const currentSession = sessionList.sessions.find(session => session.current);
    const currentRevoke = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(currentSession.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(currentRevoke.status, 400, 'current session cannot be revoked through remote-session action');
    const otherSession = sessionList.sessions.find(session => !session.current);
    assert.ok(otherSession, 'second login should create a separately revocable session');
    const revokeSession = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(otherSession.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(revokeSession.status, 200);
    const revokedSessionCheck = await fetch(`${baseUrl}/api/me`, { headers: { Authorization: `Bearer ${loginCheck.token}` } });
    assert.equal(revokedSessionCheck.status, 401, 'revoked session must no longer authenticate');
    const storeResponse = await fetch(`${baseUrl}/api/store`, { headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(storeResponse.status, 200);
    const storeBefore = await storeResponse.json();
    assert.ok(storeBefore.items.some(item => item.id === 'theme-aurora' && !item.owned));
    assert.ok(storeBefore.items.some(item => item.id === 'theme-default' && item.owned));
    assert.ok(storeBefore.categories.includes('Титулы'));
    assert.ok(storeBefore.items.some(item => item.id === 'title-star-guide'));
    assert.equal(storeBefore.dailyAvailable, undefined, 'daily rewards are not part of v1 economy');
    assert.ok(storeBefore.collections.length >= 8, 'catalog is grouped into collections');
    const bought = await postJson(baseUrl, '/api/store/buy', { itemId: 'theme-aurora' }, user1.token);
    assert.equal(bought.balance, 550);
    const stickerPackPurchase = await postJson(baseUrl, '/api/store/buy', { itemId: 'stickers-night-owl' }, user2.token);
    assert.equal(stickerPackPurchase.balance, 520);
    const stickerPackEquipped = await postJson(baseUrl, '/api/store/equip', { itemId: 'stickers-night-owl' }, user2.token);
    assert.equal(stickerPackEquipped.equipped.stickers, 'stickers-night-owl');
    const equipped = await postJson(baseUrl, '/api/store/equip', { itemId: 'theme-aurora' }, user1.token);
    assert.equal(equipped.equipped.theme, 'theme-aurora');
    const unequippedResponse = await fetch(`${baseUrl}/api/store/equip/theme`, { method: 'DELETE', headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(unequippedResponse.status, 200, 'owned cosmetics can be unequipped');
    assert.equal((await unequippedResponse.json()).equipped.theme, undefined);
    const duplicatePurchase = await fetch(`${baseUrl}/api/store/buy`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user1.token}` }, body: JSON.stringify({ itemId: 'theme-aurora' }) });
    assert.equal(duplicatePurchase.status, 400, 'store must reject duplicate purchases');
    const memberAdmin = await fetch(`${baseUrl}/api/admin/overview`, { headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(memberAdmin.status, 403, 'owner endpoints must reject regular members');
    const duplicateResponse = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Tester-One', password: 'another-password-123' }) });
    assert.equal(duplicateResponse.status, 409, 'Nickname uniqueness must be case-insensitive');
    const savedSettings = await fetch(`${baseUrl}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user1.token}` }, body: JSON.stringify({ theme: 'dark', sounds: false, soundVolume: 60, messageScale: 'large', reducedMotion: true }) });
    assert.equal(savedSettings.status, 200);
    assert.deepEqual(await savedSettings.json(), { settings: { theme: 'dark', sounds: false, soundVolume: 60, messageScale: 'large', reducedMotion: true, enterToSend: true, compactChat: false, browserNotifications: false } });
    const dailyBonus = await fetch(`${baseUrl}/api/tokens/daily`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user1.token}` }, body: '{}' });
    assert.equal(dailyBonus.status, 404, 'daily bonus endpoint must be removed');
    const tokenHistory = await (await fetch(`${baseUrl}/api/store/transactions`, { headers: { Authorization: `Bearer ${user1.token}` } })).json();
    assert.ok(!tokenHistory.transactions.some(row => ['welcome', 'daily_reward'].includes(row.kind)), 'welcome and daily rewards are not issued');
    assert.ok(tokenHistory.transactions.some(row => row.kind === 'purchase' && row.amount === -450));
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+N8AAAAASUVORK5CYII=', 'base64');
    const avatarUpload = await fetch(`${baseUrl}/api/avatar/upload`, { method: 'POST', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'image/png' }, body: tinyPng });
    assert.equal(avatarUpload.status, 201, `avatar upload failed: ${(await avatarUpload.clone().json()).error}`);
    const avatarPayload = await avatarUpload.json();
    assert.match(avatarPayload.user.avatarUrl, /\?v=/, 'avatar URL should change when the underlying file changes');
    const avatarDownload = await fetch(`${baseUrl}${avatarPayload.user.avatarUrl}`);
    assert.equal(avatarDownload.status, 200);
    assert.match(avatarDownload.headers.get('content-type'), /image\/png/);

    const socket1 = createSocket(baseUrl, { auth: { token: user1.token }, transports: ['websocket'], reconnection: false });
    const socket2 = createSocket(baseUrl, { auth: { token: user2.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket1, socket2);
    await Promise.all([
      new Promise((resolve, reject) => { socket1.once('connect', resolve); socket1.once('connect_error', reject); }),
      new Promise((resolve, reject) => { socket2.once('connect', resolve); socket2.once('connect_error', reject); })
    ]);

    const found1 = waitForEvent(socket1, 'match:found');
    const found2 = waitForEvent(socket2, 'match:found');
    await new Promise((resolve, reject) => socket1.emit('queue:join', { languages: ['Русский'], interests: ['Музыка'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    await new Promise((resolve, reject) => socket2.emit('queue:join', { languages: ['Русский'], interests: ['Музыка'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const [match1, match2] = await Promise.all([found1, found2]);
    assert.equal(match1.matchId, match2.matchId);
    const credit1 = waitForEvent(socket1, 'wallet:updated', 9000);
    const credit2 = waitForEvent(socket2, 'wallet:updated', 9000);
    testDb.prepare("UPDATE matches SET active_seconds = 59, credited_minutes = 0, last_tick_at = ? WHERE id = ?").run(new Date(Date.now() - 2500).toISOString(), match1.matchId);
    const [earned1, earned2] = await Promise.all([credit1, credit2]);
    assert.equal(earned1.earned, 1, 'one active minute credits one token');
    assert.equal(earned2.earned, 1, 'both active participants receive one token');
    const incoming = waitForEvent(socket2, 'chat:message');
    const payload = await new Promise((resolve, reject) => {
      socket1.emit('chat:send', { matchId: match1.matchId, clientId: 'integration-message-1', content: 'Привет из интеграционного теста' }, result => result?.ok ? resolve(result) : reject(new Error(result?.error)));
    });
    const received = await incoming;
    assert.equal(payload.message.content, 'Привет из интеграционного теста');
    assert.equal(received.content, payload.message.content);
    assert.equal(received.sender_id, user1.user.id);

    const selfReaction = await new Promise(resolve => socket1.emit('chat:react', { matchId: match1.matchId, messageId: payload.message.id, emoji: '🔥' }, resolve));
    assert.equal(selfReaction.ok, false, 'users must not react to their own messages');
    assert.match(selfReaction.error, /только на сообщения собеседника/);
    const reactionEvent = waitForEvent(socket1, 'chat:reactions');
    const reactionAck = await new Promise(resolve => socket2.emit('chat:react', { matchId: match1.matchId, messageId: payload.message.id, emoji: '🔥' }, resolve));
    assert.equal(reactionAck.ok, true);
    assert.equal((await reactionEvent).reactions[0].emoji, '🔥');

    const replyIncoming = waitForEvent(socket1, 'chat:message');
    const replyAck = await new Promise((resolve, reject) => socket2.emit('chat:send', { matchId: match1.matchId, clientId: 'integration-reply-1', content: 'Ответ на привет', replyToId: payload.message.id }, result => result?.ok ? resolve(result) : reject(new Error(result?.error))));
    assert.equal(replyAck.message.replyTo.id, payload.message.id);
    assert.equal((await replyIncoming).replyTo.id, payload.message.id);

    const stickerIncoming = waitForEvent(socket2, 'chat:message');
    const stickerAck = await new Promise((resolve, reject) => socket1.emit('chat:send', { matchId: match1.matchId, clientId: 'integration-sticker-1', content: '', sticker: '😂' }, result => result?.ok ? resolve(result) : reject(new Error(result?.error))));
    assert.equal(stickerAck.message.type, 'sticker');
    assert.equal((await stickerIncoming).sticker, '😂');
    const premiumStickerIncoming = waitForEvent(socket1, 'chat:message');
    const premiumStickerAck = await new Promise((resolve, reject) => socket2.emit('chat:send', { matchId: match1.matchId, clientId: 'integration-sticker-premium-1', content: '', sticker: '🌙' }, result => result?.ok ? resolve(result) : reject(new Error(result?.error))));
    assert.equal(premiumStickerAck.message.type, 'sticker');
    assert.equal((await premiumStickerIncoming).sticker, '🌙');


    const uploadResponse = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'image/png', 'X-Match-Id': match1.matchId, 'X-Media-Kind': 'image' },
      body: tinyPng
    });
    assert.equal(uploadResponse.status, 201, `media upload failed: ${(await uploadResponse.clone().json()).error}`);
    const uploadPayload = await uploadResponse.json();
    const mediaIncoming = waitForEvent(socket2, 'chat:message');
    const mediaAck = await new Promise((resolve, reject) => socket1.emit('chat:send', { matchId: match1.matchId, clientId: 'integration-media-1', content: '', attachments: [uploadPayload.file.id] }, result => result?.ok ? resolve(result) : reject(new Error(result?.error))));
    assert.equal(mediaAck.message.attachments[0].kind, 'image');
    assert.equal((await mediaIncoming).attachments[0].id, uploadPayload.file.id);

    const ended = waitForEvent(socket2, 'chat:ended');
    const endResult = await new Promise(resolve => socket1.emit('chat:end', { matchId: match1.matchId }, resolve));
    assert.equal(endResult.ok, true);
    assert.equal((await ended).matchId, match1.matchId);
    const deletedMedia = await fetch(`${baseUrl}/api/media/${uploadPayload.file.id}`, { headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(deletedMedia.status, 404, 'media must be deleted when a chat ends');
  } catch (error) {
    if (stderr) error.message += `\nServer stderr:\n${stderr}`;
    throw error;
  } finally {
    sockets.forEach(socket => socket.disconnect());
    try { testDb?.close(); } catch { /* database may not have been opened */ }
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 6000).unref();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('public mode blocks random matching while keeping the app API available', { timeout: 20_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-public-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_MODE: '1', PUBLIC_TEST_CODE: 'MATCHING-OFF-TEST', JWT_SECRET: 'public-test-secret-only-12345678901234567890' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const sockets = [];
  try {
    await waitForServer(baseUrl, child);
    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.publicMode, true);
    assert.equal(config.matchingEnabled, false);
    assert.equal(config.inviteRequired, true);
    const user = await postJson(baseUrl, '/api/auth/register', { username: 'public-tester', password: 'test-password-333', accessCode: 'MATCHING-OFF-TEST' });
    const socket = createSocket(baseUrl, { auth: { token: user.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const result = await new Promise(resolve => socket.emit('queue:join', {}, resolve));
    assert.equal(result.ok, false);
    assert.match(result.error, /Публичный подбор временно отключён/);
  } finally {
    sockets.forEach(socket => socket.disconnect());
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 6000).unref();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('invite-only public beta supports guest accounts, real matching, chat and guest upgrade', { timeout: 40_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-guest-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const accessCode = 'FRIENDS-BETA-42';
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_MODE: '1', PUBLIC_MATCHING: '1', PUBLIC_TEST_CODE: accessCode, JWT_SECRET: 'guest-integration-secret-only-12345678901234567890' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const sockets = [];
  try {
    await waitForServer(baseUrl, child);
    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.publicMode, true);
    assert.equal(config.matchingEnabled, true);
    assert.equal(config.inviteRequired, true);

    const denied = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(denied.status, 403, 'guest access requires the invitation code in public mode');

    const guest1 = await postJson(baseUrl, '/api/auth/guest', { accessCode });
    const guest2 = await postJson(baseUrl, '/api/auth/guest', { accessCode });
    assert.equal(guest1.user.accountType, 'guest');
    assert.equal(guest2.user.accountType, 'guest');
    assert.notEqual(guest1.user.id, guest2.user.id);
    assert.match(guest1.user.username, /^Гость-/);
    assert.equal(guest1.user.tokens, 0, 'guest accounts start with zero tokens');
    assert.ok(Date.parse(guest1.user.guestExpiresAt) - Date.now() > 179 * 24 * 60 * 60 * 1000, 'guest accounts should be kept for 180 days');
    const guestSessions = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${guest1.token}` } }).then(response => response.json());
    assert.ok(Date.parse(guestSessions.sessions[0].expiresAt) - Date.now() > 179 * 24 * 60 * 60 * 1000, 'guest browser session should remain valid for 180 days');
    assert.equal(guest2.user.tokens, 0, 'guest accounts start with zero tokens');
    assert.equal(Object.hasOwn(guest1.user, 'birthDate'), false);
    assert.equal(Object.hasOwn(guest1.user, 'age'), false);

    const socket1 = createSocket(baseUrl, { auth: { token: guest1.token }, transports: ['websocket'], reconnection: false });
    const socket2 = createSocket(baseUrl, { auth: { token: guest2.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket1, socket2);
    await Promise.all([
      new Promise((resolve, reject) => { socket1.once('connect', resolve); socket1.once('connect_error', reject); }),
      new Promise((resolve, reject) => { socket2.once('connect', resolve); socket2.once('connect_error', reject); })
    ]);

    const found1 = waitForEvent(socket1, 'match:found');
    const found2 = waitForEvent(socket2, 'match:found');
    await new Promise((resolve, reject) => socket1.emit('queue:join', {}, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    await new Promise((resolve, reject) => socket2.emit('queue:join', {}, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const [match1, match2] = await Promise.all([found1, found2]);
    assert.equal(match1.matchId, match2.matchId);
    assert.equal(guest1.user.tokens, 0, 'guest accounts also start without bonuses');
    assert.equal(guest2.user.tokens, 0, 'guest accounts also start without bonuses');

    const incoming = waitForEvent(socket2, 'chat:message');
    const sent = await new Promise((resolve, reject) => socket1.emit('chat:send', { matchId: match1.matchId, clientId: 'guest-message-1', content: 'Гостевой привет!' }, result => result?.ok ? resolve(result) : reject(new Error(result?.error))));
    assert.equal((await incoming).content, 'Гостевой привет!');
    assert.equal(sent.message.content, 'Гостевой привет!');

    // Verify the one-click next-partner flow using a third guest already waiting.
    const guest3 = await postJson(baseUrl, '/api/auth/guest', { accessCode });
    const socket3 = createSocket(baseUrl, { auth: { token: guest3.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket3);
    await new Promise((resolve, reject) => { socket3.once('connect', resolve); socket3.once('connect_error', reject); });
    await new Promise((resolve, reject) => socket3.emit('queue:join', {}, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const endedForPartner = waitForEvent(socket2, 'chat:ended');
    const nextForGuest1 = waitForEvent(socket1, 'match:found');
    const nextForGuest3 = waitForEvent(socket3, 'match:found');
    const nextAck = await new Promise(resolve => socket1.emit('chat:next', { matchId: match1.matchId, preferences: {} }, resolve));
    assert.equal(nextAck.ok, true);
    assert.equal((await endedForPartner).reason, 'user_next');
    const [nextMatch1, nextMatch3] = await Promise.all([nextForGuest1, nextForGuest3]);
    assert.equal(nextMatch1.matchId, nextMatch3.matchId);
    assert.notEqual(nextMatch1.matchId, match1.matchId);

    const claimed = await fetch(`${baseUrl}/api/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest1.token}` },
      body: JSON.stringify({ username: guest1.user.username, password: 'upgrade-password-123' })
    });
    assert.equal(claimed.status, 200);
    const claimedPayload = await claimed.json();
    assert.equal(claimedPayload.user.accountType, 'registered');
    const login = await postJson(baseUrl, '/api/auth/login', { username: guest1.user.username, password: 'upgrade-password-123', accessCode });
    assert.equal(login.user.id, guest1.user.id);
    const upgradedSocket = createSocket(baseUrl, { auth: { token: claimedPayload.token }, transports: ['websocket'], reconnection: false });
    sockets.push(upgradedSocket);
    const restoredAfterUpgrade = waitForEvent(upgradedSocket, 'chat:restored');
    await new Promise((resolve, reject) => { upgradedSocket.once('connect', resolve); upgradedSocket.once('connect_error', reject); });
    assert.equal((await restoredAfterUpgrade).matchId, nextMatch1.matchId, 'guest upgrade must preserve the active chat when reconnecting with the new token');
  } catch (error) {
    if (stderr) error.message += `\nServer stderr:\n${stderr}`;
    throw error;
  } finally {
    sockets.forEach(socket => socket.disconnect());
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 6000).unref();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('public mode fails closed when the invite code is not configured', { timeout: 20_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-no-invite-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_MODE: '1', PUBLIC_MATCHING: '1', PUBLIC_TEST_CODE: '', JWT_SECRET: 'no-invite-test-secret-12345678901234567890' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await waitForServer(baseUrl, child);
    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.inviteRequired, true);
    const response = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /не настроен/i);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 6000).unref();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});


test('users can view and remove their own blocklist entries', { timeout: 25_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovli-blocks-test-'));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_MODE: '0', PUBLIC_MATCHING: '1', PUBLIC_TEST_CODE: '', JWT_SECRET: 'blocklist-test-secret-12345678901234567890' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const sockets = [];
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await waitForServer(baseUrl, child);
    const first = await postJson(baseUrl, '/api/auth/register', { username: 'blocker-one', password: 'blocker-password-111' });
    const second = await postJson(baseUrl, '/api/auth/register', { username: 'blocker-two', password: 'blocker-password-222' });
    const socket1 = createSocket(baseUrl, { auth: { token: first.token }, transports: ['websocket'], reconnection: false });
    const socket2 = createSocket(baseUrl, { auth: { token: second.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket1, socket2);
    await Promise.all([
      new Promise((resolve, reject) => { socket1.once('connect', resolve); socket1.once('connect_error', reject); }),
      new Promise((resolve, reject) => { socket2.once('connect', resolve); socket2.once('connect_error', reject); })
    ]);
    const matchA = waitForEvent(socket1, 'match:found');
    const matchB = waitForEvent(socket2, 'match:found');
    await new Promise((resolve, reject) => socket1.emit('queue:join', {}, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    await new Promise((resolve, reject) => socket2.emit('queue:join', {}, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const [foundA, foundB] = await Promise.all([matchA, matchB]);
    assert.equal(foundA.matchId, foundB.matchId);
    const blocked = await postJson(baseUrl, '/api/block', {}, first.token);
    assert.equal(blocked.ok, true);
    const list = await (await fetch(`${baseUrl}/api/blocks`, { headers: { Authorization: `Bearer ${first.token}` } })).json();
    assert.equal(list.blocked.length, 1);
    assert.equal(list.blocked[0].id, second.user.id);
    const removed = await fetch(`${baseUrl}/api/blocks/${encodeURIComponent(second.user.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${first.token}` } });
    assert.equal(removed.status, 200);
    const empty = await (await fetch(`${baseUrl}/api/blocks`, { headers: { Authorization: `Bearer ${first.token}` } })).json();
    assert.equal(empty.blocked.length, 0);
  } catch (error) {
    if (stderr) error.message += `\nServer stderr:\n${stderr}`;
    throw error;
  } finally {
    sockets.forEach(socket => socket.disconnect());
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 6000).unref();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
