'use strict';

const crypto = require('node:crypto');

function scalarParameters(input, excluded = []) {
  const output = {};
  for (const [key, raw] of Object.entries(input || {})) {
    if (excluded.includes(key) || raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      if (raw.length !== 1 || raw[0] === undefined || raw[0] === null) continue;
      output[key] = String(raw[0]);
    } else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      output[key] = String(raw);
    }
  }
  return output;
}

function signature(parameters, secret, version = 3) {
  if (typeof secret !== 'string' || !secret) throw new TypeError('Paymentwall secret key is required');
  const algorithm = Number(version) === 2 ? 'md5' : Number(version) === 3 ? 'sha256' : null;
  if (!algorithm) throw new TypeError('Unsupported Paymentwall signature version');
  const values = scalarParameters(parameters, ['sign', 'sig']);
  const payload = Object.keys(values).sort().map(key => key + '=' + values[key]).join('') + secret;
  return crypto.createHash(algorithm).update(payload, 'utf8').digest('hex');
}

function verifyPingback(parameters, secret) {
  const values = scalarParameters(parameters);
  const version = Number(values.sign_version);
  if (![2, 3].includes(version)) return false;
  const supplied = String(values.sig || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(supplied) && !/^[a-f0-9]{64}$/.test(supplied)) return false;
  let expected;
  try { expected = signature(values, secret, version); } catch { return false; }
  const actualBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function buildVirtualCurrencyWidgetUrl(options) {
  const {
    publicKey, privateKey, userId, widgetCode = 'p1_1', successUrl, failureUrl,
    pingbackUrl, registrationTimestamp, paymentSystems = 'all'
  } = options || {};
  if (!publicKey || !privateKey || !userId || !widgetCode) throw new TypeError('Paymentwall widget configuration is incomplete');
  if (String(userId).length > 64) throw new TypeError('Paymentwall user ID is too long');

  const parameters = {
    key: String(publicKey),
    uid: String(userId),
    widget: String(widgetCode),
    ps: String(paymentSystems),
    sign_version: '3'
  };
  if (successUrl) parameters.success_url = String(successUrl);
  if (failureUrl) parameters.failure_url = String(failureUrl);
  if (pingbackUrl) parameters.pingback_url = String(pingbackUrl);
  if (Number.isSafeInteger(Number(registrationTimestamp)) && Number(registrationTimestamp) > 0) {
    parameters['history[registration_date]'] = String(Math.floor(Number(registrationTimestamp)));
  }
  parameters.sign = signature(parameters, String(privateKey), 3);
  const query = new URLSearchParams(parameters);
  return 'https://api.paymentwall.com/api/ps/?' + query.toString();
}

function buildDigitalGoodsCheckoutUrl(options) {
  const {
    publicKey, privateKey, userId, widgetCode = 'p1', orderId, amountMinor,
    currency = 'EUR', productName, email, successUrl, failureUrl, pingbackUrl,
    registrationTimestamp, paymentSystems = 'all'
  } = options || {};
  if (!publicKey || !privateKey || !userId || !widgetCode || !orderId || !productName || !email) {
    throw new TypeError('Paymentwall Digital Goods configuration is incomplete');
  }
  if (String(userId).length > 64 || !/^[A-Za-z0-9]+$/.test(String(userId))) throw new TypeError('Paymentwall user ID must be alphanumeric and at most 64 characters');
  if (!Number.isSafeInteger(Number(amountMinor)) || Number(amountMinor) < 30) throw new TypeError('Paymentwall one-time product price must be at least 30 minor units');
  const normalizedCurrency = String(currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw new TypeError('Invalid ISO 4217 currency');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) throw new TypeError('A valid billing email is required');
  const parameters = {
    key: String(publicKey),
    uid: String(userId),
    widget: String(widgetCode),
    ps: String(paymentSystems),
    sign_version: '3',
    email: String(email).trim().toLowerCase(),
    amount: (Number(amountMinor) / 100).toFixed(2),
    currencyCode: normalizedCurrency,
    ag_name: String(productName).slice(0, 256),
    ag_external_id: String(orderId).slice(0, 256),
    ag_type: 'fixed'
  };
  if (successUrl) parameters.success_url = String(successUrl);
  if (failureUrl) parameters.failure_url = String(failureUrl);
  if (pingbackUrl) parameters.pingback_url = String(pingbackUrl);
  if (Number.isSafeInteger(Number(registrationTimestamp)) && Number(registrationTimestamp) > 0) {
    parameters['history[registration_date]'] = String(Math.floor(Number(registrationTimestamp)));
  }
  parameters.sign = signature(parameters, String(privateKey), 3);
  return 'https://api.paymentwall.com/api/subscription?' + new URLSearchParams(parameters).toString();
}

module.exports = { scalarParameters, signature, verifyPingback, buildVirtualCurrencyWidgetUrl, buildDigitalGoodsCheckoutUrl };
