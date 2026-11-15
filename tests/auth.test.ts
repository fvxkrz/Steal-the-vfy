import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import * as auth from '../src/auth.js';
const { signBody } = auth;

test('signBody returns the raw HMAC-SHA256 hex digest of exact bytes', () => {
  const secret = randomBytes(32).toString('hex');
  const raw = Buffer.from('{ "message": "π", "n": 1 }\n');
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(signBody(secret, raw), expected);
  assert.equal(signBody(secret, raw.toString('utf8')), expected);
  assert.match(signBody(secret, raw), /^[0-9a-f]{64}$/);
  assert.notEqual(signBody(secret, raw), signBody(secret, JSON.stringify(JSON.parse(raw.toString('utf8')))));
});

test('verifySignature accepts only a single exact 64-hex HMAC of the raw body', () => {
  assert.equal(typeof auth.verifySignature, 'function', 'signature verifier is not implemented');
  const secret = randomBytes(32).toString('hex');
  const raw = Buffer.from('{"a":1}\n');
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(auth.verifySignature(secret, raw, signature), true);
  assert.equal(auth.verifySignature(secret, raw.toString('utf8'), signature.toUpperCase()), true);
  assert.equal(auth.verifySignature(secret, Buffer.from('{ "a": 1 }\n'), signature), false);
  assert.equal(auth.verifySignature(randomBytes(32).toString('hex'), raw, signature), false);
  for (const invalid of [
    undefined, '', '0'.repeat(64), signature.slice(1), `${signature}0`,
    `sha256=${signature}`, ` ${signature}`, `${signature}\n`, 'z'.repeat(64),
    `${signature}, ${signature}`, [signature], [signature, signature],
  ]) {
    assert.equal(auth.verifySignature(secret, raw, invalid), false);
  }
});
