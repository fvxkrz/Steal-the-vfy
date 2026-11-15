import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const match = '9f4e1b2a-1234-4abc-9def-0123456789ab';
test('turn reservations cache exact wire bytes and permanently bind match/turn, nonce and idempotency key', async () => {
  const module = await import('../src/store.js').catch(() => null);
  assert.ok(module, 'Steal turn ledger is not implemented');
  const dir = mkdtempSync(join(tmpdir(), 'steal-ledger-test-'));
  let store = new module.TurnStore(join(dir, 'turns.sqlite'));
  try {
    const one = store.reserve(match, 1, 'body-a', 'nonce-a'); assert.equal(one.kind, 'fresh');
    if (one.kind !== 'fresh') return;
    const key = one.idempotencyKey;
    assert.equal(store.reserve(match, 1, 'body-a', 'nonce-a').kind, 'processing');
    assert.equal(store.reserve(match, 1, 'changed-body', 'nonce-a').kind, 'conflict');
    assert.equal(store.reserve(match, 2, 'body-b', 'nonce-a').kind, 'reused');
    assert.throws(() => store.complete(match, 1, 'body-a', 'wrong-lease', '{"action":{"type":"HOLD"}}'));
    store.complete(match, 1, 'body-a', one.lease, '{"action":{"type":"HOLD"}}');
    store.close(); store = new module.TurnStore(join(dir, 'turns.sqlite'));
    assert.deepEqual(store.reserve(match, 1, 'body-a', 'nonce-a'), { kind: 'cached', body: '{"action":{"type":"HOLD"}}', idempotencyKey: key });
    const two = store.reserve(match, 2, 'body-b', 'nonce-b'); assert.equal(two.kind, 'fresh');
    if (two.kind === 'fresh') assert.notEqual(two.idempotencyKey, key);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a match commitment cannot change across turns, connections or restarts', async () => {
  const { TurnStore } = await import('../src/store.js');
  const dir = mkdtempSync(join(tmpdir(), 'steal-match-freeze-'));
  const a = new TurnStore(join(dir, 'turns.sqlite')); const b = new TurnStore(join(dir, 'turns.sqlite'));
  try {
    const one = '0x' + '11'.repeat(32); const two = '0x' + '22'.repeat(32);
    assert.equal(a.bindMatch(match, one), true);
    assert.equal(b.bindMatch(match, one.toUpperCase().replace('0X','0x')), true);
    assert.equal(b.bindMatch(match, two), false);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
