# Steal the VFY — confirmed protocol and unresolved adapter

Sources retrieved:
- https://agentgames.zkverify.io/build (Steal the VFY builder section)
- https://agentgames.zkverify.io/guide
- https://agentgames.zkverify.io/rules
- https://agentgames.zkverify.io/events/steal-the-vfy
- https://agentgames.zkverify.io/api/circuit-info
- Kurier Swagger v1.36.0: https://api-testnet.kurier.xyz/docs/json

The event's published turn envelope carries protocolVersion, eventId, mode,
matchId, turn, issuedAt, deadlineAt, state, strategyCommitment.hash,
resolverVersion and nonce. The HTTP request is HMAC authenticated on raw bytes;
the event page says 5-minute turn deadlines and approximately 30 seconds per push.
The local service chooses a 25-second transport budget. Those are not Gatekeeper's
60-second bounds.

## Official public-input hash

The `/build` source specifies Keccak256 over eight unsigned, big-endian 32-byte
words in exact order:

1. strategy commitment hash as integer
2. match UUID with hyphens removed, parsed as a hexadecimal integer
3. turn
4. selfBalance
5. opponentBalance
6. action code: HOLD=0, FORTIFY=1, EXTRACT=2
7. amount: zero for HOLD/FORTIFY, requested value for EXTRACT
8. circuitVersion `v1` encoded as integer 1

The corresponding `viem` fixed-width `numberToHex(..., {size: 32})` implementation
is in `src/public-hash.ts`, verified against independently ABI-packed uint256
fixtures. The request schema enforces omission of `action.amount` for HOLD and
FORTIFY even though the internal hash uses a zero word.

## Official circuit interface witnessed locally

Official WASM/zkey hashes:
- `vfy-policy.wasm`: `bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2`
- `vfy-policy_final.zkey`: `f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41`

The exported VK reports Groth16/bn128, nine public inputs, IC length 10.
WASM signal discovery yields scalar inputs `commitment`, `matchId`, `turnNumber`,
`selfBalance`, `opponentBalance`, `action`, `amount`, `circuitVersion`, `salt`,
plus `strategyParams[8]`. Exact local public signals:

```
[0] Poseidon3(matchId, turnNumber, circuitVersion)
[1] commitment
[2] matchId
[3] turnNumber
[4] selfBalance
[5] opponentBalance
[6] action
[7] amount
[8] circuitVersion
```

The circuit locally verifies commitment as
`Poseidon9([strategyParams[0], ..., strategyParams[7], salt])`.
Both Poseidon relations match synthetic vectors with the pinned circuit using
`poseidon-lite`; proof generation/verification tests exercise the actual official
files. The field `matchId` in this private witness was converted locally using
the public UUID-integer encoding. This is a candidate adapter conversion, **not an
accepted platform witness vector**.

## User-authorized policy

For the ordinary tested domain, accepted circuit witnesses implement:

```
if selfBalance < strategyParams[1]:
    action = FORTIFY
elif opponentBalance > strategyParams[2] and strategyParams[3] == 0:
    action = EXTRACT
else:
    action = HOLD
amount = strategyParams[0] if action == EXTRACT else 0
```

Parameters p4–p7 must remain zero for tested valid witnesses. The user's chosen
aggressive request policy maps to the fixed private candidate vector
`[10,0,0,0,0,0,0,0]`: request EXTRACT 10 when opponent balance is positive; HOLD
when opponent balance is zero. The vector is enforced by configuration validation;
there is no silent policy heuristic substitution. Production salt and parameters
must be supplied privately through the environment. No actual secret preimage is
included in this repository.

**Critical amount distinction:** the circuit accepts EXTRACT request amount 10
when opponent balance is 1 or 5 and rejects amount 1 or 5 under the same vector.
The circuit therefore encodes the fixed requested amount, not a locally clipped
transfer amount. The platform's public resolver prose says “steals up to N” but
only an accepted platform practice task can confirm it resolves the small-balance
request as expected. The agent stays in practice mode; scored competition requests
are answered HOLD.

The circuit has no fortified-until-turn witness inputs, and probes show it can
prove FORTIFY when selfBalance is 0. The selected policy currently never
FORTIFYs. Changes to the user's strategy require a new explicit choice, a new
commitment preview and fresh proof tests.

## Still unknown / not claimed

- An official accepted full turn/witness/proof vector and the platform's exact
  conversion of incoming task state into circuit witness.
- Whether registered strategy commitment values are represented on-wire in the
  exact local fixed-width hexadecimal form emitted by `scripts/commitment.ts`.
- Resolver acceptance/scoring of a 10-unit request when opponent balance is 1–9.
- Strategy handling of fortified state: that state is absent from this circuit's
  witnessed inputs, and no extra behavior is invented.
- Testnet VK registration, actual testnet job finality, platform practice score,
  dashboard preflight, public HTTPS reachability, Docker image build or scored
  tournament activation.

Do not treat 110 successful synthetic witness attempts as 110 verified proofs:
the audit separately generated and verified 11 proofs. Local Groth16 validity is
necessary but does not establish platform acceptance or winning performance.
