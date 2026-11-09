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
  return 'https://api.paymentwall.com/api/subscription?' + query.toString();
}

module.exports = { scalarParameters, signature, verifyPingback, buildVirtualCurrencyWidgetUrl };
