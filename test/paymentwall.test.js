'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signature, verifyPingback, buildVirtualCurrencyWidgetUrl } = require('../lib/paymentwall.cjs');

test('Paymentwall signature is independent of parameter insertion order', () => {
  const a = signature({ uid: 'u-1', type: '0', ref: 'ref-1', sign_version: '3', currency: '500' }, 'secret', 3);
  const b = signature({ currency: '500', ref: 'ref-1', sign_version: '3', type: '0', uid: 'u-1' }, 'secret', 3);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('Paymentwall pingback signature validates and rejects tampering', () => {
  const params = { uid: 'u-1', type: '0', ref: 'ref-1', sign_version: '3', currency: '500' };
  params.sig = signature(params, 'private-key', 3);
  assert.equal(verifyPingback(params, 'private-key'), true);
  assert.equal(verifyPingback({ ...params, currency: '5000' }, 'private-key'), false);
  assert.equal(verifyPingback(params, 'wrong-key'), false);
});

test('Paymentwall widget URL contains a verifiable server signature and safe user identity', () => {
  const url = new URL(buildVirtualCurrencyWidgetUrl({
    publicKey: 'public', privateKey: 'private', userId: 'user-123', widgetCode: 'p1_1',
    successUrl: 'https://solvi.example/?billing=success',
    failureUrl: 'https://solvi.example/?billing=cancelled',
    pingbackUrl: 'https://solvi.example/api/billing/paymentwall/pingback',
    registrationTimestamp: 1760000000
  }));
  assert.equal(url.hostname, 'api.paymentwall.com');
  const params = Object.fromEntries(url.searchParams.entries());
  const supplied = params.sign;
  delete params.sign;
  assert.equal(supplied, signature(params, 'private', 3));
  assert.equal(params.uid, 'user-123');
  assert.equal(params.ps, 'all');
});
