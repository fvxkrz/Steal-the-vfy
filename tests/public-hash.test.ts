import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePacked, keccak256, toHex } from 'viem';

test('publicInputsHash follows exactly the eight 32-byte ABI-packed fields from /build', async () => {
  const module = await import('../src/public-hash.js').catch(() => null);
  assert.ok(module, 'Steal the VFY public-input hash is not implemented');
  const turn = { matchId: '9f4e1b2a-1234-4abc-9def-0123456789ab', turn: 3,
    state: { selfBalance: '95', opponentBalance: '105' }, strategyCommitment: { hash: '0x' + '12'.repeat(32) } };
  const expected = keccak256(encodePacked(['uint256','uint256','uint256','uint256','uint256','uint256','uint256','uint256'],
    [BigInt(turn.strategyCommitment.hash), BigInt('0x' + turn.matchId.replaceAll('-', '')), 3n, 95n, 105n, 2n, 5n, 1n]));
  assert.equal(module.publicInputsHash(turn, { type: 'EXTRACT', amount: 5 }), expected);
  const words = [BigInt(turn.strategyCommitment.hash), BigInt('0x' + turn.matchId.replaceAll('-', '')), 3n, 95n, 105n, 0n, 0n, 1n];
  assert.equal(module.publicInputsHash(turn, { type: 'HOLD' }), keccak256(('0x' + words.map(x => toHex(x, { size: 32 }).slice(2)).join('')) as `0x${string}`));
  assert.notEqual(module.publicInputsHash(turn, { type: 'FORTIFY' }), expected);
});

test('safe HOLD includes the documented public-input hash while omitting action.amount', async () => {
  const { safeHold } = await import('../src/protocol.js');
  const { sampleTurn } = await import('./fixtures.js');
  const { publicInputsHash } = await import('../src/public-hash.js');
  const turn = sampleTurn(); const response = safeHold(turn);
  assert.equal(response.policyProof.publicInputsHash, publicInputsHash(turn, { type: 'HOLD' }));
  assert.equal(Object.hasOwn(response.action, 'amount'), false);
});
