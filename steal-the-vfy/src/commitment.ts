import { poseidon9 } from 'poseidon-lite';

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function isField(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,76})$/.test(value) && BigInt(value) < FIELD;
}

export interface StrategyConfig {
  readonly params: readonly string[];
  readonly salt: string;
  readonly commitment: `0x${string}`;
  readonly circuitVersion: 'v1';
}

/** No private production values are generated or defaulted. */
export function loadStrategyConfig(env: NodeJS.ProcessEnv = process.env): StrategyConfig | undefined {
  const encoded = env.STRATEGY_PARAMS_JSON;
  const salt = env.STRATEGY_SALT;
  if (encoded === undefined && salt === undefined) return undefined;
  try {
    if (encoded === undefined || salt === undefined) throw new Error('STRATEGY_CONFIGURATION');
    const params = JSON.parse(encoded) as string[];
    const commitment = computeCommitment(params, salt);
    // These are approval constraints, NOT fallback private values.
    // p1/p2 thresholds and p3 disable flag must remain zero; p4..p7 are reserved.
    if (params.some((value, index) => value !== (index === 0 ? '10' : '0'))) throw new Error('STRATEGY_CONFIGURATION');
    if (env.STRATEGY_COMMITMENT !== undefined && env.STRATEGY_COMMITMENT !== commitment) throw new Error('STRATEGY_CONFIGURATION');
    return { params, salt, commitment, circuitVersion: 'v1' };
  } catch {
    // JSON parser errors can contain private values. Never forward their cause.
    throw new Error('STRATEGY_CONFIGURATION');
  }
}

/** Poseidon9(params[0..7], salt), encoded as a public 32-byte field element. */
export function computeCommitment(params: readonly string[], salt: string): `0x${string}` {
  if (!Array.isArray(params) || params.length !== 8 || !Array.from(params).every(isField) || !isField(salt)) {
    throw new Error('STRATEGY_CONFIGURATION');
  }
  return `0x${poseidon9([...params, salt]).toString(16).padStart(64, '0')}`;
}
