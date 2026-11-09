'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signature, verifyPingback, buildVirtualCurrencyWidgetUrl, buildDigitalGoodsCheckoutUrl } = require('../lib/paymentwall.cjs');

test('Paymentwall signature is independent of parameter insertion order', () => {
  const a = signature({ uid: 'u-1', type: '0', ref: 'ref-1', sign_version: '3', currency: '500' }, 'secret', 3);
  const b = signature({ currency: '500', ref: 'ref-1', sign_version: '3', type: '0', uid: 'u-1' }, 'secret', 3);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('Paymentwall Virtual Currency uses type=0 for payment credit and type=2 for reversal (handled by route)', () => {
  const success = { uid: 'ABCDEF1234', currency: '500', type: '0', ref: 'vc-ref-1', sign_version: '3' };
  success.sig = signature(success, 'private-key', 3);
  assert.equal(verifyPingback(success, 'private-key'), true);
  const reversal = { uid: 'ABCDEF1234', currency: '500', type: '2', ref: 'vc-ref-1', sign_version: '3' };
  reversal.sig = signature(reversal, 'private-key', 3);
  assert.equal(verifyPingback(reversal, 'private-key'), true);
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
    publicKey: 'public', privateKey: 'private', userId: 'ABCDEF1234', widgetCode: 'p1_1', email: 'buyer@example.com',
    successUrl: 'https://solvi.example/?billing=success',
    failureUrl: 'https://solvi.example/?billing=cancelled',
    registrationTimestamp: 1760000000
  }));
  assert.equal(url.hostname, 'api.paymentwall.com');
  assert.equal(url.pathname, '/api/ps/');
  const params = Object.fromEntries(url.searchParams.entries());
  const supplied = params.sign;
  delete params.sign;
  assert.equal(supplied, signature(params, 'private', 3));
  assert.equal(params.uid, 'ABCDEF1234');
  assert.equal(params.ps, 'all');
});

test('Paymentwall Digital Goods creates a one-time checkout for one server-priced item', () => {
  const url = new URL(buildDigitalGoodsCheckoutUrl({
    publicKey: 'public', privateKey: 'private', userId: 'ABCDEF1234', widgetCode: 'p1_1',
    orderId: 'solvi_order_123', amountMinor: 499, currency: 'EUR',
    productName: 'SOLVI · Северное сияние', email: 'buyer@example.com',
    successUrl: 'https://solvi.example/?billing=success',
    failureUrl: 'https://solvi.example/?billing=cancelled',
        registrationTimestamp: 1760000000
  }));
  assert.equal(url.pathname, '/api/subscription');
  const params = Object.fromEntries(url.searchParams.entries());
  const supplied = params.sign;
  delete params.sign;
  assert.equal(supplied, signature(params, 'private', 3));
  assert.equal(params.ag_external_id, 'solvi_order_123');
  assert.equal(params.ag_type, 'fixed');
  assert.equal(params.amount, '4.99');
  assert.equal(params.currencyCode, 'EUR');
});
