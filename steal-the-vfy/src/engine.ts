import { createHash } from 'node:crypto';
import { safeHold, type Turn, type TurnResponse } from './protocol.js';
import { publicInputsHash } from './public-hash.js';
import { aggressivePolicy } from './strategy.js';
import type { TurnStore } from './store.js';
import { assertBinding, type Prover } from './prover.js';
import type { Finalizer } from './zkverify.js';
import type { StrategyConfig } from './commitment.js';

interface Options { store: TurnStore; prover: Prover; strategy?: StrategyConfig; finalizer?: Finalizer;
  shutdownSignal?: AbortSignal; maxInFlight?: number; proofTimeoutMs?: number }
export interface Engine { handle(turn: Turn, raw: Buffer, signal: AbortSignal): Promise<TurnResponse | string>;
  onOutcome(turn: Turn, raw: Buffer, signal: AbortSignal, wire: string): void; ready(): boolean }
function bounded<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); return; }
    Promise.resolve().then(action).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  });
}
export function createEngine(options: Options): Engine {
  let active = 0;
  const leases = new WeakMap<AbortSignal, { matchId: string; turn: number; bodyHash: string; lease: string }>();
  const hold = (turn: Turn, idempotencyKey?: string): TurnResponse => {
    const response = safeHold(turn);
    if (idempotencyKey) response.idempotencyKey = idempotencyKey;
    response.policyProof.publicInputsHash = publicInputsHash(turn, response.action); return response;
  };
  return {
    // This release is practice-only until an accepted platform vector and resolver
    // behavior have been independently verified. There is no environment bypass.
    ready: () => false,
    onOutcome: (turn, raw, signal, wire) => {
      const owned = leases.get(signal);
      if (!owned || owned.matchId !== turn.matchId.toLowerCase() || owned.turn !== turn.turn ||
          owned.bodyHash !== createHash('sha256').update(raw).digest('hex')) return;
      leases.delete(signal);
      try { options.store.complete(owned.matchId, owned.turn, owned.bodyHash, owned.lease, wire); } catch { /* already consumed; do not resubmit */ }
    },
    handle: async (turn, raw, signal) => {
      const expire = Date.parse(turn.deadlineAt);
      if (signal.aborted || options.shutdownSignal?.aborted || !Number.isFinite(expire) || Date.now() >= expire) return hold(turn);
      const bodyHash = createHash('sha256').update(raw).digest('hex'); const matchId = turn.matchId.toLowerCase();
      let reservation;
      try { reservation = options.store.reserve(matchId, turn.turn, bodyHash, turn.nonce); }
      catch { return hold(turn); }
      if (reservation.kind === 'cached') {
        try {
          const action = JSON.parse(reservation.body) as TurnResponse;
          if (action.action.type !== 'HOLD' && (turn.mode !== 'practice' || !options.strategy ||
            turn.strategyCommitment.hash.toLowerCase() !== options.strategy.commitment || !options.finalizer)) return hold(turn, reservation.idempotencyKey);
          return reservation.body;
        } catch { return hold(turn); }
      }
      if (reservation.kind !== 'fresh') return hold(turn);
      leases.set(signal, { matchId, turn: turn.turn, bodyHash, lease: reservation.lease });
      const fallback = () => hold(turn, reservation.idempotencyKey);
      const strategy = options.strategy;
      try {
        if (!options.store.bindMatch(matchId, turn.strategyCommitment.hash)) return fallback();
      } catch { return fallback(); }
      if (turn.mode !== 'practice' || !strategy || !options.finalizer ||
          strategy.commitment !== turn.strategyCommitment.hash.toLowerCase() || active >= (options.maxInFlight ?? 1)) return fallback();
      active++;
      const deadline = AbortSignal.any([signal, ...(options.shutdownSignal ? [options.shutdownSignal] : []), AbortSignal.timeout(Math.max(1, expire - Date.now()))]);
      try {
        const action = aggressivePolicy(turn.state); const hash = publicInputsHash(turn, action);
        const { buildPolicyWitness } = await import('./witness.js');
        const expected = buildPolicyWitness(turn, strategy, action);
        const proofSignal = AbortSignal.any([deadline, AbortSignal.timeout(options.proofTimeoutMs ?? 12_000)]);
        const bundle = await bounded(() => options.prover.prove(expected.witness, expected.expectedSignals, proofSignal), proofSignal);
        proofSignal.throwIfAborted(); assertBinding(bundle, expected.expectedSignals);
        const finalizer = options.finalizer;
        const evidence = await bounded(() => finalizer.finalize(bundle, deadline), deadline);
        deadline.throwIfAborted();
        if (Date.now() >= expire || !evidence || evidence.status !== 'Finalized' || typeof evidence.jobId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(evidence.jobId) || typeof evidence.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(evidence.txHash) ||
            typeof evidence.blockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(evidence.blockHash)) return fallback();
        return { matchId: turn.matchId, turn: turn.turn, action,
          policyProof: { circuitVersion: 'v1', publicInputsHash: hash, proofReference: evidence.txHash },
          proof: bundle.proof, public_signals: bundle.public_signals, agentTimestamp: new Date().toISOString(), idempotencyKey: reservation.idempotencyKey };
      } catch { return fallback(); } finally { active--; }
    },
  };
}
