import assert from 'node:assert/strict';
import test from 'node:test';
import * as protocol from '../src/protocol.js';
import { publicInputsHash } from '../src/public-hash.js';

function parsedTurn(): protocol.Turn {
  const value = protocol.parseEnvelope(turnFixture());
  if ('type' in value) throw new Error('fixture is not a turn');
  return value;
}

test('safeHold echoes only validated identity, never fabricates proof, and uses unique keys', () => {
  assert.equal(typeof protocol.safeHold, 'function');
  const turn = parsedTurn();
  const first = protocol.safeHold(turn);
  const second = protocol.safeHold(turn);
  assert.deepEqual(Object.keys(first).sort(), ['matchId', 'turn', 'action', 'policyProof', 'agentTimestamp', 'idempotencyKey'].sort());
  assert.equal(first.matchId, turn.matchId);
  assert.equal(first.turn, turn.turn);
  assert.deepEqual(first.action, { type: 'HOLD' });
  assert.deepEqual(first.policyProof, { circuitVersion: 'v1', publicInputsHash: publicInputsHash(turn, { type: 'HOLD' }) });
  assert.ok(Number.isFinite(Date.parse(first.agentTimestamp)));
  assert.match(first.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('response parsing accepts only the documented action union and exact wire fields', () => {
  assert.equal(typeof protocol.parseTurnResponse, 'function');
  const base = protocol.safeHold(parsedTurn());
  for (const action of [{ type: 'HOLD' }, { type: 'FORTIFY' }, { type: 'EXTRACT', amount: 1 }, { type: 'EXTRACT', amount: 10 }]) {
    const value = { ...base, action, proof: { pi_a: ['1', '2'] }, public_signals: ['95', '105'] };
    assert.deepEqual(protocol.parseTurnResponse(value), value);
  }
  for (const action of [
    { type: 'HOLD', amount: 0 }, { type: 'FORTIFY', amount: 0 }, { type: 'EXTRACT' },
    { type: 'EXTRACT', amount: 0 }, { type: 'EXTRACT', amount: 11 }, { type: 'EXTRACT', amount: 1.5 },
    { type: 'EXTRACT', amount: '5' }, { type: 'EXTRACT', amount: 1, extra: true }, { type: 'APPROVE' },
  ]) assert.throws(() => protocol.parseTurnResponse({ ...base, action }));
  for (const patch of [
    { extra: true }, { reason: 'timeout' }, { idempotencyKey: '' }, { policyProof: { circuitVersion: 'v2' } },
    { policyProof: { circuitVersion: 'v1', extra: true } }, { proof: [] }, { public_signals: [1] },
    { agentTimestamp: '2026-11-15' },
  ]) assert.throws(() => protocol.parseTurnResponse({ ...base, ...patch }));
});

export function turnFixture() {
  return {
    protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice',
    matchId: '9f4e1b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b', turn: 3,
    issuedAt: '2026-11-15T00:00:00.000Z', deadlineAt: '2026-11-15T00:05:00.000Z',
    state: { selfBalance: '95', opponentBalance: '105', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: 4 },
    strategyCommitment: { hash: `0x${'ab'.repeat(32)}` }, resolverVersion: 'v1', nonce: 'nonce-3',
  };
}

test('parseEnvelope accepts the documented turn and common preflight without rewriting values', () => {
  assert.equal(typeof protocol.parseEnvelope, 'function');
  const turn = turnFixture();
  assert.deepEqual(protocol.parseEnvelope(turn), turn);
  const preflight = { type: 'agent-games.preflight.v1', agent_id: 'agt_abc', issued_at: '2026-11-15T08:00:00+08:00', nonce: 'abc123' };
  assert.deepEqual(protocol.parseEnvelope(preflight), preflight);
});

test('parseEnvelope fails closed on unknown, ambiguous, unsupported or malformed fields', () => {
  const base = turnFixture();
  for (const patch of [
    { extra: true }, { protocolVersion: 'v2' }, { eventId: 'other' }, { resolverVersion: 'v2' },
    { mode: 'testnet' }, { matchId: '9f4e1b2a-...' }, { turn: 0 }, { turn: 21 }, { turn: 1.5 },
    { issuedAt: '2026-11-15T00:00:00' }, { issuedAt: '2026-02-30T00:00:00Z' },
    { deadlineAt: '2026-11-15T00:00:00.000Z' }, { deadlineAt: '2026-11-15T00:05:00.001Z' },
    { nonce: '' }, { strategyCommitment: { hash: '0xab' } },
    { strategyCommitment: { ...base.strategyCommitment, extra: 1 } },
    ...['-1', '01', '+1', '1.0', '1e2', '4294967296', ''].map(selfBalance => ({ state: { ...base.state, selfBalance } })),
    { state: { ...base.state, selfBalance: 95 } },
    { state: { ...base.state, extra: true } },
    { state: { ...base.state, opponentFortifiedUntilTurn: -1 } },
    { state: { ...base.state, opponentFortifiedUntilTurn: 1.5 } },
  ]) assert.throws(() => protocol.parseEnvelope({ ...base, ...patch }), JSON.stringify(patch));
  for (const bad of [null, [], {}, { type: 'agent-games.preflight.v1', agent_id: 'agt', issued_at: base.issuedAt, nonce: 'n', extra: 1 }]) {
    assert.throws(() => protocol.parseEnvelope(bad));
  }
  assert.equal((protocol.parseEnvelope({ ...base, state: { ...base.state, selfBalance: '4294967295' } }) as { state: { selfBalance: string } }).state.selfBalance, '4294967295');
});
