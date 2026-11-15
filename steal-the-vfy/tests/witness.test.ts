import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseEnvelope, type Action, type Turn } from '../src/protocol.js';
import type { StrategyConfig } from '../src/commitment.js';

// Public synthetic fixture from the independent circuit analysis, never production secrets.
const params = ['10', '0', '0', '0', '0', '0', '0', '0'] as const;
const salt = '42';
const commitment = '0x2375c02b633bc06d7ea0e664a9fd94a43dfaeb54fe787b71196726b3c7e393ac' as `0x${string}`;
const strategy: StrategyConfig = { params, salt, commitment, circuitVersion: 'v1' };

function turn(patch: Record<string, unknown> = {}): Turn {
  const value = {
    protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice',
    matchId: '9f4e1b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b', turn: 3,
    issuedAt: '2026-11-15T00:00:00.000Z', deadlineAt: '2026-11-15T00:05:00.000Z',
    state: { selfBalance: '95', opponentBalance: '105', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
    strategyCommitment: { hash: commitment }, resolverVersion: 'v1', nonce: 'synthetic-witness', ...patch,
  };
  const parsed = parseEnvelope(value);
  assert.ok(!('type' in parsed));
  return parsed;
}

test('policy witness binds exact official input names, public signal order, Poseidon3 output, and fixed-width commitment', async () => {
  const module = await import('../src/witness.js').catch(() => null);
  assert.ok(module, 'vfy-policy witness binding is not implemented');
  const result = module.buildPolicyWitness(turn(), strategy, { type: 'EXTRACT', amount: 10 });
  assert.deepEqual(Object.keys(result.witness), ['commitment', 'matchId', 'turnNumber', 'selfBalance', 'opponentBalance', 'action', 'amount', 'circuitVersion', 'salt', 'strategyParams']);
  assert.deepEqual(result.witness, {
    commitment: '16038997112020182322173448379678790230845526951830566086947884141750627046316',
    matchId: '211752801456072022525339298125651593819', turnNumber: '3', selfBalance: '95', opponentBalance: '105',
    action: '2', amount: '10', circuitVersion: '1', salt: '42', strategyParams: [...params],
  });
  assert.deepEqual(result.expectedSignals, [
    '5055622806871526235403532884153798792390369150634048689556485294792101509278',
    '16038997112020182322173448379678790230845526951830566086947884141750627046316',
    '211752801456072022525339298125651593819', '3', '95', '105', '2', '10', '1',
  ]);
});

test('practice-only witness construction rejects competition, stale commitments, non-policy actions, and malformed numeric bindings with one sanitized error', async () => {
  const { buildPolicyWitness } = await import('../src/witness.js');
  const sanitized = (error: unknown) => error instanceof Error && error.message === 'WITNESS_CONFIGURATION';
  const cases: Array<[Turn, StrategyConfig, Action]> = [
    [turn({ mode: 'competition' }), strategy, { type: 'EXTRACT', amount: 10 }],
    [turn({ strategyCommitment: { hash: `0x${'00'.repeat(32)}` } }), strategy, { type: 'EXTRACT', amount: 10 }],
    [turn(), strategy, { type: 'EXTRACT', amount: 5 }],
    [turn(), strategy, { type: 'HOLD' }],
    [turn({ state: { selfBalance: '95', opponentBalance: '0', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null } }), strategy, { type: 'EXTRACT', amount: 10 }],
    [({ ...turn(), state: { ...turn().state, selfBalance: '4294967296' } } as Turn), strategy, { type: 'EXTRACT', amount: 10 }],
    [({ ...turn(), matchId: 'not-a-uuid' } as Turn), strategy, { type: 'EXTRACT', amount: 10 }],
  ];
  for (const [value, config, action] of cases) assert.throws(() => buildPolicyWitness(value, config, action), sanitized);
  assert.throws(() => buildPolicyWitness(turn(), { ...strategy, salt: 'private-invalid-salt' }, { type: 'EXTRACT', amount: 10 }), sanitized);
  assert.throws(() => buildPolicyWitness(turn(), { ...strategy, commitment: `0x${'00'.repeat(32)}` }, { type: 'EXTRACT', amount: 10 }), sanitized);
});

test('depleted opponent binds HOLD with amount zero rather than clipped extraction', async () => {
  const { buildPolicyWitness } = await import('../src/witness.js');
  const value = turn({ state: { selfBalance: '0', opponentBalance: '0', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null } });
  const result = buildPolicyWitness(value, strategy, { type: 'HOLD' });
  assert.equal(result.witness.action, '0');
  assert.equal(result.witness.amount, '0');
  assert.equal(result.expectedSignals[6], '0');
  assert.equal(result.expectedSignals[7], '0');
});

test('synthetic witness generates and locally verifies an actual proof with the pinned official circuit', { timeout: 120_000 }, async () => {
  const { loadArtifacts } = await import('../src/artifacts.js');
  const { ProcessProver } = await import('../src/prover.js');
  const { buildPolicyWitness } = await import('../src/witness.js');
  const artifacts = await loadArtifacts(fileURLToPath(new URL('../circuits', import.meta.url)));
  const prover = new ProcessProver(artifacts);
  for (const [value, action] of [
    [turn(), { type: 'EXTRACT', amount: 10 }],
    [turn({ state: { selfBalance: '95', opponentBalance: '1', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null } }), { type: 'EXTRACT', amount: 10 }],
    [turn({ state: { selfBalance: '0', opponentBalance: '0', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null } }), { type: 'HOLD' }],
  ] as const) {
    const expected = buildPolicyWitness(value, strategy, action);
    const bundle = await prover.prove(expected.witness, expected.expectedSignals, AbortSignal.timeout(120_000));
    assert.deepEqual(bundle.public_signals, expected.expectedSignals);
    assert.equal(await prover.verify(bundle, AbortSignal.timeout(60_000)), true);
  }
});
