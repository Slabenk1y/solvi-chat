'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: createSocket } = require('socket.io-client');
const jwt = require('jsonwebtoken');
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
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_MODE: '0', PUBLIC_MATCHING: '1', PUBLIC_TEST_CODE: '', SOLVI_PURGE_NON_OWNER_USERS: '0', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', APP_PUBLIC_URL: '', BILLING_CURRENCY: 'eur', VIP_PRICE_MINOR: '499', PREMIUM_PRICE_MINOR: '899', JWT_SECRET: 'test-secret-for-integration-tests-only-1234567890', OWNER_PUBLIC_ID: 'ABCDEF1234' },
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
    assert.equal(user1.user.tokens, 50, 'new accounts receive the 50-token registration bonus');
    assert.equal(user2.user.tokens, 50, 'new accounts receive the 50-token registration bonus');
    const billingCatalog = await fetch(`${baseUrl}/api/billing/catalog`, { headers: { Authorization: `Bearer ${user1.token}` } }).then(response => response.json());
    assert.equal(billingCatalog.configured, false, 'Stripe stays disabled until server secrets are set');
    assert.deepEqual(billingCatalog.products.map(product => [product.id, product.amountMinor]), [['vip-30d', 499], ['premium-30d', 899]]);
    const billingCheckout = await fetch(`${baseUrl}/api/billing/checkout`, { method: 'POST', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'vip-30d' }) });
    assert.equal(billingCheckout.status, 503, 'checkout must remain disabled without Stripe secrets');
    const publicConfig = await fetch(`${baseUrl}/api/config`).then(response => response.json());
    assert.deepEqual(publicConfig.socialLinks.map(link => [link.platform, link.url]), [['Telegram', 'https://t.me/ChatSolvi'], ['TikTok', 'https://www.tiktok.com/@slabenk1y_armagedon']], 'the supplied SOLVI social links are seeded by default');
    const growth = await fetch(`${baseUrl}/api/growth`, { headers: { Authorization: `Bearer ${user1.token}` } }).then(response => response.json());
    assert.deepEqual(growth.tasks, [], 'reward tasks are empty until configured by the owner');
    assert.deepEqual(growth.socialLinks.map(link => link.url), ['https://t.me/ChatSolvi', 'https://www.tiktok.com/@slabenk1y_armagedon']);
    const initialTicket = await postJson(baseUrl, '/api/tickets', { category: 'idea', title: 'Интеграционный тикет', body: 'Проверка приватного тикета и корректного закрытия обращения.' }, user1.token);
    const privateTicket = await fetch(`${baseUrl}/api/tickets/${initialTicket.id}`, { headers: { Authorization: `Bearer ${user2.token}` } });
    assert.equal(privateTicket.status, 404, 'users cannot read another account ticket');
    const ticketClose = await fetch(`${baseUrl}/api/tickets/${initialTicket.id}/close`, { method: 'POST', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(ticketClose.status, 200, 'users can close their own tickets');
    const closedTicketReply = await fetch(`${baseUrl}/api/tickets/${initialTicket.id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Ответ после закрытия тикета' }) });
    assert.equal(closedTicketReply.status, 409, 'closed tickets cannot receive replies');
    testDb = new DatabaseSync(path.join(dataDir, 'orbit.sqlite'));
    const owner = await postJson(baseUrl, '/api/auth/register', { username: 'solvi-owner', password: 'test-owner-password-333' });
    testDb.prepare('UPDATE users SET public_id = ? WHERE id = ?').run('ABCDEF1234', owner.user.id);
    const ownerHeaders = { Authorization: `Bearer ${owner.token}` };
    const ownerUserListResponse = await fetch(`${baseUrl}/api/admin/users?limit=1`, { headers: ownerHeaders });
    assert.equal(ownerUserListResponse.status, 200, 'owner can retrieve unified paginated user directory');
    const ownerUserList = await ownerUserListResponse.json();
    assert.ok(ownerUserList.total >= 3);
    assert.equal(ownerUserList.users.length, 1);
    assert.equal(ownerUserList.hasMore, true);
    const accountDetailsResponse = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(user1.user.id)}`, { headers: ownerHeaders });
    assert.equal(accountDetailsResponse.status, 200, 'owner can open individual account details');
    const accountDetails = await accountDetailsResponse.json();
    assert.equal(accountDetails.user.createdAt, user1.user.createdAt);
    assert.ok(Object.hasOwn(accountDetails.stats, 'activeSessions'));
    const personalPromo = await postJson(baseUrl, `/api/admin/users/${encodeURIComponent(user1.user.id)}/promo`, { code: 'PRIVATE-TEST-01', tokens: 35 }, owner.token);
    const otherAccountRedeem = await fetch(`${baseUrl}/api/promos/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user2.token}` }, body: JSON.stringify({ code: 'PRIVATE-TEST-01' }) });
    assert.equal(otherAccountRedeem.status, 404, 'a personal promo must not be discoverable by another account');
    const personalRedeem = await postJson(baseUrl, '/api/promos/redeem', { code: 'PRIVATE-TEST-01' }, user1.token);
    assert.equal(personalRedeem.reward.tokens, 35, 'the intended account can redeem its personal promo');
    const personalPromoStats = await fetch(`${baseUrl}/api/admin/promos/${encodeURIComponent(personalPromo.promo.id)}`, { headers: ownerHeaders }).then(response => response.json());
    assert.equal(personalPromoStats.stats.uniqueUsers, 1);
    const personalPromoUpdate = await fetch(`${baseUrl}/api/admin/promos/${encodeURIComponent(personalPromo.promo.id)}`, { method: 'PATCH', headers: { ...ownerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'PRIVATE-TEST-02', maxUses: 1, active: true }) });
    assert.equal(personalPromoUpdate.status, 200, 'owner can edit promo codes');
    const updatedAccountDetails = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(user1.user.id)}`, { headers: ownerHeaders }).then(response => response.json());
    assert.equal(updatedAccountDetails.stats.promoRedemptions, 1, 'account stats include promo redemptions');
    const taskNow = new Date().toISOString();
    testDb.prepare('INSERT INTO reward_tasks (id,title,description,platform,url,reward_tokens,sponsor_name,active,max_claims,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)').run('integration-task', 'Подпишись на канал', 'Тестовое задание с ручной проверкой доказательства.', 'Telegram', 'https://t.me/example', 40, 'SOLVI Test', 1, taskNow, taskNow);
    const taskSubmission = await postJson(baseUrl, '/api/tasks/integration-task/submit', { proofUrl: 'https://example.com/proof.png' }, user1.token);
    assert.equal(taskSubmission.status, 'pending');
    const duplicateTaskSubmission = await fetch(`${baseUrl}/api/tasks/integration-task/submit`, { method: 'POST', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ proofUrl: 'https://example.com/another-proof.png' }) });
    assert.equal(duplicateTaskSubmission.status, 409, 'one account must only submit a reward task once');
    const cappedTaskSubmission = await fetch(`${baseUrl}/api/tasks/integration-task/submit`, { method: 'POST', headers: { Authorization: `Bearer ${user2.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ proofUrl: 'https://example.com/proof-2.png' }) });
    assert.equal(cappedTaskSubmission.status, 409, 'task max_claims must be enforced');
    testDb.prepare('UPDATE users SET tokens = 1000 WHERE id IN (?, ?)').run(user1.user.id, user2.user.id);
    testDb.prepare("INSERT OR IGNORE INTO store_inventory (user_id, item_id, acquired_at, source) VALUES (?, 'wallpaper-deep-space', ?, 'purchase')").run(user1.user.id, new Date().toISOString());
    testDb.prepare("DELETE FROM store_equipped WHERE user_id = ? AND slot = 'theme'").run(user1.user.id);
    testDb.prepare("INSERT INTO store_equipped (user_id, slot, item_id, updated_at) VALUES (?, 'wallpaper', 'wallpaper-deep-space', ?)").run(user1.user.id, new Date().toISOString());
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
    assert.ok(storeBefore.categories.includes('Темы'));
    assert.ok(!storeBefore.categories.includes('Обои'), 'wallpapers are now full-interface themes');
    assert.ok(storeBefore.items.some(item => item.id === 'wallpaper-deep-space' && item.category === 'Темы' && item.slot === 'theme' && item.owned && item.equipped));
    assert.equal(storeBefore.equipped.theme, 'wallpaper-deep-space', 'legacy wallpaper equipment should migrate into full interface themes');
    assert.equal(storeBefore.equipped.wallpaper, undefined, 'legacy wallpaper slot should be retired');
    assert.equal(storeBefore.memberships.find(item => item.id === 'vip-1h')?.price, 180);
    assert.equal(storeBefore.memberships.find(item => item.id === 'premium-1h')?.price, 360);
    assert.equal(storeBefore.memberships.find(item => item.id === 'vip-24h')?.price, 4320);
    assert.equal(storeBefore.memberships.find(item => item.id === 'premium-24h')?.price, 8640);
    assert.equal(storeBefore.memberships.find(item => item.id === 'vip-6h')?.price, 1080);
    assert.equal(storeBefore.memberships.find(item => item.id === 'premium-6h')?.price, 2160);
    assert.equal(storeBefore.memberships.find(item => item.id === 'vip-6h')?.hours, 6);
    assert.equal(storeBefore.memberships.find(item => item.id === 'premium-6h')?.hours, 6);
    assert.equal(storeBefore.items.find(item => item.id === 'theme-aurora')?.price, 300);
    assert.equal(storeBefore.items.find(item => item.id === 'stickers-night-owl')?.price, 330);
    assert.ok(storeBefore.items.some(item => item.id === 'title-star-guide'));
    assert.equal(storeBefore.dailyAvailable, undefined, 'daily rewards are not part of v1 economy');
    assert.ok(storeBefore.collections.length >= 8, 'catalog is grouped into collections');
    const tokenStatus = await postJson(baseUrl, '/api/store/membership', { packageId: 'vip-1h' }, user1.token);
    assert.equal(tokenStatus.user.subscriptionTier, 'vip');
    const tokenOnlyBundle = await fetch(`${baseUrl}/api/store/bundle`, { method: 'POST', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bundleId: 'vip-signature-pack' }) });
    assert.equal(tokenOnlyBundle.status, 403, 'a VIP status bought only with tokens must not unlock the VIP cosmetic bundle');
    const bought = await postJson(baseUrl, '/api/store/buy', { itemId: 'theme-aurora' }, user1.token);
    assert.equal(bought.balance, 520);
    const stickerPackPurchase = await postJson(baseUrl, '/api/store/buy', { itemId: 'stickers-night-owl' }, user2.token);
    assert.equal(stickerPackPurchase.balance, 670);
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
    assert.ok(tokenHistory.transactions.some(row => row.kind === 'purchase' && row.amount === -300));
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

    const profile1 = await fetch(`${baseUrl}/api/profile`, { method: 'PATCH', headers: { Authorization: `Bearer ${user1.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user1.user.username, gender: 'male' }) }).then(response => response.json());
    const profile2 = await fetch(`${baseUrl}/api/profile`, { method: 'PATCH', headers: { Authorization: `Bearer ${user2.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user2.user.username, gender: 'female' }) }).then(response => response.json());
    assert.equal(profile1.user.gender, 'male');
    assert.equal(profile2.user.gender, 'female');
    const adultDenied = await new Promise(resolve => socket1.emit('queue:join', { mode: 'flirt', adultConfirmed: false }, resolve));
    assert.equal(adultDenied.ok, false, 'adult queue must reject missing age consent');
    assert.match(adultDenied.error, /18/);

    const found1 = waitForEvent(socket1, 'match:found');
    const found2 = waitForEvent(socket2, 'match:found');
    await new Promise((resolve, reject) => socket1.emit('queue:join', { mode: 'chat', desiredGender: 'female', languages: ['Русский'], interests: ['Музыка'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    await new Promise((resolve, reject) => socket2.emit('queue:join', { mode: 'chat', desiredGender: 'male', languages: ['Русский'], interests: ['Музыка'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const [match1, match2] = await Promise.all([found1, found2]);
    assert.equal(match1.matchId, match2.matchId);

    await postJson(baseUrl, '/api/favorites', { matchId: match1.matchId }, user1.token);
    const savedFavorites = await fetch(`${baseUrl}/api/favorites`, { headers: { Authorization: `Bearer ${user1.token}` } }).then(response => response.json());
    assert.equal(savedFavorites.favorites[0].username, match1.partner.username);
    assert.equal(Object.hasOwn(savedFavorites.favorites[0], 'description'), false, 'favorites expose only the avatar and nickname');
    assert.equal(Object.hasOwn(savedFavorites.favorites[0], 'publicId'), false, 'favorites do not expose contact identifiers');
    const favoriteRemoved = await fetch(`${baseUrl}/api/favorites/${encodeURIComponent(match1.partner.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${user1.token}` } });
    assert.equal(favoriteRemoved.status, 200);

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

    const selfReply = await new Promise(resolve => socket1.emit('chat:send', {
      matchId: match1.matchId, clientId: 'integration-self-reply-1', content: 'Ответ самому себе', replyToId: payload.message.id
    }, resolve));
    assert.equal(selfReply.ok, false, 'users must not reply to their own messages');
    assert.match(selfReply.error, /Нельзя отвечать на собственное сообщение/);

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

    const roleplayFound1 = waitForEvent(socket1, 'match:found');
    const roleplayFound2 = waitForEvent(socket2, 'match:found');
    await new Promise((resolve, reject) => socket1.emit('queue:join', { mode: 'roleplay', adultConfirmed: true, desiredGender: 'female', roleplayIntent: 'seeking', interests: ['Фэнтези'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    await new Promise((resolve, reject) => socket2.emit('queue:join', { mode: 'roleplay', adultConfirmed: true, desiredGender: 'male', roleplayIntent: 'offering', interests: ['Фэнтези'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const [roleplay1, roleplay2] = await Promise.all([roleplayFound1, roleplayFound2]);
    assert.equal(roleplay1.mode, 'roleplay');
    assert.equal(roleplay2.mode, 'roleplay');
    assert.equal(roleplay1.matchId, roleplay2.matchId);
    const adultStamp1 = testDb.prepare('SELECT adult_asserted_at FROM users WHERE id = ?').get(user1.user.id).adult_asserted_at;
    assert.notEqual(adultStamp1, 'NOT_COLLECTED', 'adult consent timestamp must be persisted');
    const roleplayEnded = waitForEvent(socket2, 'chat:ended');
    await new Promise(resolve => socket1.emit('chat:end', { matchId: roleplay1.matchId }, resolve));
    await roleplayEnded;

    const flirtFound1 = waitForEvent(socket1, 'match:found');
    const flirtFound2 = waitForEvent(socket2, 'match:found');
    await new Promise((resolve, reject) => socket1.emit('queue:join', { mode: 'flirt', adultConfirmed: true, desiredGender: 'female', interests: ['Романтика'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    await new Promise((resolve, reject) => socket2.emit('queue:join', { mode: 'flirt', adultConfirmed: true, desiredGender: 'male', interests: ['Романтика'] }, result => result?.ok ? resolve() : reject(new Error(result?.error))));
    const [flirt1, flirt2] = await Promise.all([flirtFound1, flirtFound2]);
    assert.equal(flirt1.mode, 'flirt');
    assert.equal(flirt1.matchId, flirt2.matchId);
    const flirtEnded = waitForEvent(socket2, 'chat:ended');
    await new Promise(resolve => socket1.emit('chat:end', { matchId: flirt1.matchId }, resolve));
    await flirtEnded;
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

    const guestAvatarChoice = await fetch(`${baseUrl}/api/profile`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${guest1.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: '🦊' })
    });
    assert.equal(guestAvatarChoice.status, 200, 'guest accounts can choose a standard avatar');
    assert.equal((await guestAvatarChoice.json()).user.avatar, '🦊');
    const guestAvatarPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+N8AAAAASUVORK5CYII=', 'base64');
    const guestAvatarUpload = await fetch(`${baseUrl}/api/avatar/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guest1.token}`, 'Content-Type': 'image/png' },
      body: guestAvatarPng
    });
    assert.equal(guestAvatarUpload.status, 201, 'guest accounts can upload a custom avatar');
    assert.match((await guestAvatarUpload.json()).user.avatarUrl, /\\?v=/);
    assert.ok(Date.parse(guest1.user.guestExpiresAt) - Date.now() > 2 * 24 * 60 * 60 * 1000, 'guest accounts should remain valid for three days');
    const guestSessions = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${guest1.token}` } }).then(response => response.json());
    assert.ok(Date.parse(guestSessions.sessions[0].expiresAt) - Date.now() > 2 * 24 * 60 * 60 * 1000, 'guest browser session should remain valid for three days');
    const decodedGuestToken = jwt.decode(guest1.token);
    const expiredLegacyGuestToken = jwt.sign(
      { sub: decodedGuestToken.sub, publicId: decodedGuestToken.publicId, accountType: 'guest', iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 60 },
      'guest-integration-secret-only-12345678901234567890',
      { issuer: 'orbit-chat', jwtid: decodedGuestToken.jti }
    );
    const legacyGuestSession = await fetch(`${baseUrl}/api/me`, { headers: { Authorization: `Bearer ${expiredLegacyGuestToken}` } });
    assert.equal(legacyGuestSession.status, 200, 'legacy guest JWTs remain usable only while their shortened three-day database session is valid');
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

    const guestClaim = await fetch(`${baseUrl}/api/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest1.token}` },
      body: JSON.stringify({ username: guest1.user.username, password: 'upgrade-password-123' })
    });
    assert.equal(guestClaim.status, 403, 'guest identity cannot be converted by setting a nickname and password');
    const guestRename = await fetch(`${baseUrl}/api/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest1.token}` },
      body: JSON.stringify({ username: 'НовоеИмя' })
    });
    assert.equal(guestRename.status, 403, 'guest nickname cannot be changed');
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
