import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadArtifacts } from '../src/artifacts.js';
import { loadStrategyConfig } from '../src/commitment.js';
import { createEngine } from '../src/engine.js';
import { ProcessProver } from '../src/prover.js';
import { publicInputsHash } from '../src/public-hash.js';
import { parseTurnResponse } from '../src/protocol.js';
import { createServer } from '../src/server.js';
import { TurnStore } from '../src/store.js';
import { signBody, verifySignature } from '../src/auth.js';
import { sampleTurn } from '../tests/fixtures.js';

/** Synthetic public vector and mocked finality; never a platform acceptance claim. */
export async function replay(): Promise<Record<string, unknown>> {
  const strategy = loadStrategyConfig({ STRATEGY_PARAMS_JSON: JSON.stringify(['10','0','0','0','0','0','0','0']), STRATEGY_SALT: '42' });
  if (!strategy) throw new Error('REPLAY_SETUP');
  const artifacts = await loadArtifacts(fileURLToPath(new URL('../circuits', import.meta.url)));
  const prover = new ProcessProver(artifacts); const store = new TurnStore(':memory:');
  let submissions = 0;
  const engine = createEngine({ store, strategy, prover, finalizer: { finalize: async (_bundle, signal) => {
    signal.throwIfAborted(); submissions++;
    return { jobId: 'MOCKED_ONLY', status: 'Finalized', txHash: '0x'+'ab'.repeat(32), blockHash: '0x'+'cd'.repeat(32) };
  } } });
  const secret = randomBytes(32).toString('hex');
  const server = createServer({ secret, handler: engine.handle, onOutcome: engine.onOutcome, ready: engine.ready });
  try {
    const turn = sampleTurn({ strategyCommitment: { hash: strategy.commitment },
      state: { selfBalance: '95', opponentBalance: '5', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null } });
    const raw = JSON.stringify(turn); const request = { method: 'POST' as const, url: '/agent',
      headers: { 'content-type': 'application/json', 'x-agent-games-signature': signBody(secret, raw) }, payload: raw };
    const response = await server.inject(request);
    assert.equal(response.statusCode, 200);
    const responseSignature = response.headers['x-agent-games-signature'];
    if (typeof responseSignature !== 'string') throw new Error('REPLAY_SIGNATURE');
    assert.equal(verifySignature(secret, response.body, responseSignature), true);
    const value = parseTurnResponse(response.json());
    assert.deepEqual(value.action, { type: 'EXTRACT', amount: 10 });
    assert.equal(value.policyProof.publicInputsHash, publicInputsHash(turn, value.action));
    if (!value.proof || !value.public_signals) throw new Error('REPLAY_PROOF_MISSING');
    assert.equal(await prover.verify({ proof: value.proof, public_signals: value.public_signals }, AbortSignal.timeout(60_000)), true);
    assert.equal(submissions, 1);
    const retry = await server.inject(request); assert.equal(retry.body, response.body); assert.equal(submissions, 1);
    assert.equal(engine.ready(), false);
    return { event: 'steal_vfy_local_replay_passed', realProofsVerified: 1, finalizer: 'MOCKED_ONLY',
      opponentBalance: '5', requestedAmount: 10, sameWireCachedRetry: true, platformAcceptance: 'UNVERIFIED', competitionReady: false };
  } finally { await server.close(); store.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await replay()) + '\n'); }
  catch { process.stderr.write('steal_vfy_replay_failed\n'); process.exitCode = 1; }
}
