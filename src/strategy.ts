import type { Action } from './protocol.js';

// Explicitly chosen by the user; this module is not a claimed optimal strategy.
// It is not activated until the official policy circuit proves the same action.
export function aggressivePolicy(state: { selfBalance: string; opponentBalance: string; selfFortifiedUntilTurn?: number | null; opponentFortifiedUntilTurn?: number | null }): Action {
  for (const value of [state.selfBalance, state.opponentBalance]) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,9})$/.test(value) || BigInt(value) > 4294967295n) throw new Error('INVALID_STATE');
  }
  if (BigInt(state.opponentBalance) === 0n) return { type: 'HOLD' };
  // The witnessed circuit proves the fixed requested amount 10; it rejects
  // silently clipped amounts such as 1 or 5. The resolver may cap the gain.
  return { type: 'EXTRACT', amount: 10 };
}
