import { concat, keccak256, numberToHex } from 'viem';
import type { Action } from './protocol.js';

interface HashTurn { matchId: string; turn: number; state: { selfBalance: string; opponentBalance: string }; strategyCommitment: { hash: string } }
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UINT256_MAX = (1n << 256n) - 1n;
export function publicInputsHash(turn: HashTurn, action: Action): `0x${string}` {
  if (!UUID.test(turn.matchId) || !/^0x[0-9a-fA-F]{64}$/.test(turn.strategyCommitment.hash) ||
    !Number.isSafeInteger(turn.turn) || turn.turn < 1 || turn.turn > 20) throw new Error('INVALID_HASH_INPUT');
  const balance = (value: string): bigint => {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > UINT256_MAX) throw new Error('INVALID_HASH_INPUT');
    return BigInt(value);
  };
  const amount = action.type === 'EXTRACT' ? action.amount : 0;
  if (!['HOLD', 'FORTIFY', 'EXTRACT'].includes(action.type) ||
      !Number.isSafeInteger(amount) || (action.type === 'EXTRACT' && (amount < 1 || amount > 10)) ||
      (action.type !== 'EXTRACT' && Object.hasOwn(action, 'amount'))) throw new Error('INVALID_HASH_INPUT');
  // Exact /build order. This is the full 256-bit Keccak digest, never field-reduced.
  const values = [BigInt(turn.strategyCommitment.hash), BigInt('0x' + turn.matchId.replaceAll('-', '')),
    BigInt(turn.turn), balance(turn.state.selfBalance), balance(turn.state.opponentBalance),
    { HOLD: 0n, FORTIFY: 1n, EXTRACT: 2n }[action.type], BigInt(amount), 1n];
  return keccak256(concat(values.map(value => numberToHex(value, { size: 32 }))));
}
