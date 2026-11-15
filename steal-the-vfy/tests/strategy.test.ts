import test from 'node:test';
import assert from 'node:assert/strict';

test('user-selected max-legal-extract policy uses BigInt and never emits an amount on HOLD', async () => {
  const module = await import('../src/strategy.js').catch(() => null);
  assert.ok(module, 'user-approved aggressive policy is not implemented');
  assert.deepEqual(module.aggressivePolicy({ selfBalance: '100', opponentBalance: '105', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }), { type: 'EXTRACT', amount: 10 });
  assert.deepEqual(module.aggressivePolicy({ selfBalance: '0', opponentBalance: '7', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }), { type: 'EXTRACT', amount: 10 });
  assert.deepEqual(module.aggressivePolicy({ selfBalance: '100', opponentBalance: '0', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null }), { type: 'HOLD' });
  assert.throws(() => module.aggressivePolicy({ selfBalance: '100', opponentBalance: '-1' }), /INVALID_STATE/);
});
