import { publicInputsHash } from './public-hash.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const isoTimestamp = z.iso.datetime({ offset: true });
const uint = z.number().int().nonnegative().safe();
// A conservative LOCAL support policy, not a claim about official game bounds.
const balance = z.string().regex(/^(0|[1-9][0-9]{0,9})$/).refine(value => BigInt(value) <= 0xffff_ffffn);
const matchId = z.uuid();
const turnNumber = z.number().int().min(1).max(20);
const nonempty = z.string().min(1);

const turnSchema = z.strictObject({
  protocolVersion: z.literal('v1'),
  eventId: z.literal('steal-the-vfy'),
  mode: z.enum(['practice', 'competition']),
  matchId,
  turn: turnNumber,
  issuedAt: isoTimestamp,
  deadlineAt: isoTimestamp,
  state: z.strictObject({
    selfBalance: balance,
    opponentBalance: balance,
    selfFortifiedUntilTurn: uint.nullable(),
    opponentFortifiedUntilTurn: uint.nullable(),
  }),
  strategyCommitment: z.strictObject({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  resolverVersion: z.literal('v1'),
  nonce: nonempty,
}).refine(turn => {
  const windowMs = Date.parse(turn.deadlineAt) - Date.parse(turn.issuedAt);
  return windowMs > 0 && windowMs <= 300_000;
}, { message: 'turn window must be positive and at most five minutes' });
const preflightSchema = z.strictObject({
  type: z.literal('agent-games.preflight.v1'),
  agent_id: nonempty,
  issued_at: isoTimestamp,
  nonce: nonempty,
});

export type Turn = z.infer<typeof turnSchema>;
export type Preflight = z.infer<typeof preflightSchema>;

/** Validate without coercion, normalization, defaults, or unknown-field stripping. */
export function parseEnvelope(value: unknown): Turn | Preflight {
  return z.union([turnSchema, preflightSchema]).parse(value);
}

const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('HOLD') }),
  z.strictObject({ type: z.literal('FORTIFY') }),
  z.strictObject({ type: z.literal('EXTRACT'), amount: z.number().int().min(1).max(10) }),
]);
const turnResponseSchema = z.strictObject({
  matchId,
  turn: turnNumber,
  action: actionSchema,
  policyProof: z.strictObject({
    circuitVersion: z.literal('v1'),
    publicInputsHash: z.string().optional(),
    proofReference: z.string().optional(),
  }),
  agentTimestamp: isoTimestamp,
  idempotencyKey: nonempty,
  proof: z.record(z.string(), z.unknown()).optional(),
  public_signals: z.array(z.string()).optional(),
});
export type Action = z.infer<typeof actionSchema>;
export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type AgentResponse = TurnResponse | { error: string };

export function parseTurnResponse(value: unknown): TurnResponse {
  return turnResponseSchema.parse(value);
}

/** No proof is claimed on uncertainty. The engine may add the actual HOLD hash. */
export function safeHold(turn: Turn): TurnResponse {
  return {
    matchId: turn.matchId,
    turn: turn.turn,
    action: { type: 'HOLD' },
    policyProof: { circuitVersion: 'v1', publicInputsHash: publicInputsHash(turn, { type: 'HOLD' }) },
    agentTimestamp: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
}
