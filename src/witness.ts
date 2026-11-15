import { poseidon3 } from 'poseidon-lite';
import type { StrategyConfig } from './commitment.js';
import { computeCommitment } from './commitment.js';
import type { Action, Turn } from './protocol.js';
import { aggressivePolicy } from './strategy.js';

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const UINT32_MAX = 4_294_967_295n;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const COMMITMENT = /^0x[0-9a-f]{64}$/;

export type WitnessValue = string | string[];
export interface PolicyWitness {
  witness: Record<string, WitnessValue>;
  expectedSignals: string[];
}

function invalid(): never {
  throw new Error('WITNESS_CONFIGURATION');
}

function uint32(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) invalid();
  const number = BigInt(value);
  if (number > UINT32_MAX) invalid();
  return value;
}

function approvedConfig(config: StrategyConfig): void {
  if (config.circuitVersion !== 'v1' || !COMMITMENT.test(config.commitment) ||
      !Array.isArray(config.params) || config.params.length !== 8 ||
      config.params.some((value, index) => value !== (index === 0 ? '10' : '0')) ||
      computeCommitment(config.params, config.salt) !== config.commitment) invalid();
}

function sameAction(actual: Action, expected: Action): boolean {
  if (!actual || typeof actual !== 'object' || actual.type !== expected.type) return false;
  if (expected.type === 'EXTRACT') {
    return actual.type === 'EXTRACT' && actual.amount === expected.amount && Object.keys(actual).length === 2;
  }
  return Object.keys(actual).length === 1;
}

/**
 * Build the exact vfy-policy witness and its nine decimal public signals.
 * The UUID integer conversion is only a local candidate matching the documented
 * public-hash encoding; it is not a claim about the platform's proof adapter.
 */
export function buildPolicyWitness(turn: Turn, config: StrategyConfig, action: Action): PolicyWitness {
  try {
    if (turn.mode !== 'practice') invalid();
    approvedConfig(config);
    if (!UUID.test(turn.matchId) || turn.strategyCommitment.hash.toLowerCase() !== config.commitment) invalid();
    if (!Number.isSafeInteger(turn.turn) || turn.turn < 1 || turn.turn > 20) invalid();
    const selfBalance = uint32(turn.state.selfBalance);
    const opponentBalance = uint32(turn.state.opponentBalance);
    const matchId = BigInt(`0x${turn.matchId.replaceAll('-', '')}`).toString();
    if (BigInt(matchId) >= FIELD) invalid();
    const turnNumber = String(turn.turn);
    const circuitVersion = '1';
    const expectedAction = aggressivePolicy({ selfBalance, opponentBalance });
    if (!sameAction(action, expectedAction)) invalid();
    const actionValue = action.type === 'HOLD' ? '0' : action.type === 'FORTIFY' ? '1' : '2';
    const amount = action.type === 'EXTRACT' ? String(action.amount) : '0';
    const commitment = BigInt(config.commitment).toString();
    const output = poseidon3([matchId, turnNumber, circuitVersion]).toString();
    const witness: Record<string, WitnessValue> = {
      commitment,
      matchId,
      turnNumber,
      selfBalance,
      opponentBalance,
      action: actionValue,
      amount,
      circuitVersion,
      salt: config.salt,
      strategyParams: [...config.params],
    };
    const expectedSignals = [output, commitment, matchId, turnNumber, selfBalance, opponentBalance, actionValue, amount, circuitVersion];
    return { witness, expectedSignals };
  } catch {
    throw new Error('WITNESS_CONFIGURATION');
  }
}
