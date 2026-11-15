import type { Turn } from '../src/protocol.js';

// Synthetic public local fixtures, not actual platform tasks or private strategy values.
export function sampleTurn(patch: Partial<Turn> = {}): Turn {
  const now = Date.now();
  return { protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice',
    matchId: '9f4e1b2a-1234-4abc-9def-0123456789ab', turn: 1,
    issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 300_000).toISOString(),
    state: { selfBalance: '100', opponentBalance: '100', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
    strategyCommitment: { hash: '0x' + '12'.repeat(32) }, resolverVersion: 'v1', nonce: 'local-synthetic-nonce', ...patch };
}
