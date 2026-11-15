# Steal the VFY — private-policy HTTP agent

Separate TypeScript/Node.js 22 service for the zkVerify Agent Games tournament.
The platform posts signed turns to your public HTTPS endpoint; it never executes
this repository. No Gatekeeper artifacts, payment decisions or ledger are shared.

## Status and chosen policy

The user explicitly chose **request EXTRACT 10 when opponent balance is positive;
HOLD when it is zero**. This is a fixed requested amount, not a promise of ten
VFY gain. Independent local WASM witness/proof tests found that the supplied fixed
policy circuit accepts request amount 10 even when opponent balance is 1–9, and
rejects clipping the request to that smaller balance. Low-balance compatibility
must still be confirmed through platform practice.

This release intentionally permits candidate proofs only for signed `mode:
"practice"` turns. **Competition turns fail closed to signed HOLD, and `/readyz`
stays 503. There is no environment switch that bypasses that activation gate.**
Local real-proof verification, platform acceptance, chain finality and public
HTTPS deployment are different tests. No scored registration, commitment freeze,
wallet signature or mainnet transaction is performed by building this project.

## Authoritative inputs and unresolved compatibility

Read the current official pages before using this code:
- https://agentgames.zkverify.io/build — select the **Steal the VFY** builder tab.
- https://agentgames.zkverify.io/guide — endpoint, secret and practice workflow.
- https://agentgames.zkverify.io/rules — eligibility, idempotency, signatures.
- https://agentgames.zkverify.io/events/steal-the-vfy — tournament/deadline rules.
- https://agentgames.zkverify.io/api/circuit-info — event-specific mainnet VK.

Snapshots are retained in `docs/`. `docs/circuit-analysis.md` records numeric
observations, not official accepted vectors. The published protocol gives the
exact full Keccak `publicInputsHash` recipe, while the artifact independently
exposes nine public signals with a Poseidon match/turn/version output. Those are
not interchangeable. No digest is silently reduced into a field element.

Remaining prerequisites before competition:
- An accepted platform practice vector confirming UUID-to-witness conversion,
  public signals and registration's commitment representation.
- Practice confirmation that request 10 is allowed when opponent balance is 1–9.
- A genuine testnet VK registration and finalized proof with your API key.
- A public HTTPS host, dashboard secret, passing dashboard preflight and practice.
- An explicit review before enabling competition handling or registering/freezing
  the public commitment. A successful local proof alone does not clear these.

## Layout

- `src/auth.ts`, `protocol.ts`, `server.ts`: raw-body HMAC, strict turn/preflight
  schemas and exact signed responses. Authenticated failures default to echoed
  HOLD without fake proof; invalid/untrusted envelopes receive signed errors.
- `src/public-hash.ts`: exact eight-word Keccak recipe from `/build`.
- `src/strategy.ts`, `commitment.ts`, `witness.ts`: deterministic user-selected
  policy, Poseidon commitment and explicit numeric candidate witness binding.
- `src/prover.ts`, `prover-child.ts`: isolated, cancellable snarkjs workers that
  locally verify the proof and match all nine public signals before returning.
- `src/store.ts`: durable SQLite turn/nonce/idempotency ledger and match commitment
  freeze. Unknown/in-progress outcomes stay consumed after a crash.
- `src/engine.ts`: practice-only proving/finality pipeline and final-wire caching.
- `src/zkverify.ts`: reviewed Kurier client with fixed testnet/mainnet hosts,
  documented HTTP 200/202 handling and exact `Finalized` confirmation.
- `scripts/commitment.ts`: prints only a public commitment hash, not its preimage.
- `scripts/replay.ts`: synthetic turn replay using real local proofs and explicitly
  mocked chain responses. It never claims a live chain result.
- `deploy/`: pinned Docker/Caddy HTTPS deployment recipe.

## Local installation and tests

```sh
npm ci
npm run artifacts:verify
npm run typecheck
npm test
npm run build
npm run replay
```

The root `npm test` runs both the TypeScript service suite and the isolated simple
Express demo workspace. Its child-process test checks raw-body authentication,
signed response bytes and allowlisted echo behavior; it does not replace service
proof/policy tests.

Node 22.16+ and npm are required. The SQLite native module may need a C++ compiler,
make and Python if no prebuilt binary exists. The production runtime needs no
TypeScript loader. Exact dependencies and a lockfile are included. Poseidon uses
`poseidon-lite`, verified against synthetic official-circuit/circomlibjs vectors;
the heavier circomlibjs/ethers5 dependency chain is not shipped.

The public downloaded `vfy-policy.wasm` and `vfy-policy_final.zkey`, plus the VK
exported from that zkey, are pinned with SHA-256 and checked before serving. Never
replace a pin merely to make a changed circuit pass. Review changed semantics.

The independent circuit audit recovered nine scalar witness inputs plus
`strategyParams[8]`, nine public signals, the Poseidon9 commitment input order,
and local fixed-policy behavior. Synthetic real Groth16 tests prove extraction
request 10 at opponent balances 1, 5 and 105, plus HOLD at zero. These are local
circuit conformance results, **not accepted platform vectors** or a formal proof
of behavior over every BN128 field value. See `docs/circuit-analysis.md`.

## Configuration — all private values remain local

Copy `.env.example` to `.env`, set private file permissions and populate it on the
host or in its secret manager. `.env`, keys, databases and build caches are ignored.
Never paste a dashboard secret, API key, strategy salt, seed or private key in chat.

- `AGENT_GAMES_HMAC_SECRET`: exact plaintext from dashboard **Rotate Secret**;
  mandatory at startup, blank in the example. Do not invent a local placeholder.
- `KURIER_API_KEY`: dedicated testnet key; mainnet keys are separate.
- `KURIER_VK_HASH`: confirmed registration on the selected network. The published
  VFY policy hash is mainnet-only evidence, not proof of testnet registration.
- `STRATEGY_PARAMS_JSON`: eight canonical decimal **strings**, kept private and
  matching the selected policy/circuit. No production parameter defaults are set.
- `STRATEGY_SALT`: private canonical field value; do not expose or log it.
- `STRATEGY_COMMITMENT`: optional public pin, checked against the derived hash.
- `ZKVERIFY_NETWORK`: `testnet` by default; mainnet requires explicit opt-in.
- `DB_PATH`: persistent shared-on-this-host SQLite file. Do not deploy independent
  ledgers behind a load balancer; multi-host service needs a shared transactional
  database with equivalent uniqueness/ownership guarantees.
- `RESPONSE_BUDGET_MS`: 25,000 default, below the approximately 30-second push wait.
- The signed turn window is up to 5 minutes, **not** Gatekeeper's 60 seconds.

All parameter values and `STRATEGY_SALT` must be configured privately before the
service can generate candidate proofs. No production preimage or default salt is
embedded. This selected policy currently requires the exact parameter vector
`[10,0,0,0,0,0,0,0]`; the local README/test vector and the salt `42` are synthetic
only.

Run compiled service using environment-only secrets:

```sh
node --env-file=.env dist/src/main.js
```

Generate the public hash locally only, without sending registration requests:

```sh
node --env-file=.env --import tsx scripts/commitment.ts
```

No production salt is generated or registered automatically. Retain the exact
secret configuration securely; changing it changes the commitment. `HOLD` and
`FORTIFY` must omit the amount field entirely, including on fallback responses.

## Separate minimal Express demo

`simple-demo/` is a deliberately tiny, separate Express example for understanding
signed raw-body requests. Copy `simple-demo/.env.example` to `simple-demo/.env` and
fill that demo's secret separately; never copy production keys into it. It is **not the game agent**: it does not validate a
tournament schema, decide an action, generate a proof, implement readiness or
support public HTTPS. It binds only loopback and echoes an allowlist of safe fields.
Never register it as an event agent or expose its HTTP port publicly.

```sh
npm ci
npm run demo:test
# Optional local-only run after setting demo HMAC secret privately:
npm run demo:start
```

The root `npm test` also includes the demo's raw-signature-before-JSON and signed
response test. The production candidate remains the separate strict TypeScript
service described above.

## Security and replay behavior

HMAC-SHA256 checks the exact raw bytes before JSON parsing with constant-time
comparison and rejects malformed/duplicate signatures. Responses are serialized,
validated, signed and sent as the same bytes. Logs never contain request bodies,
private parameters, salt, API/HMAC secrets or raw provider errors/URLs. Kurier
places API keys in URL paths; redirects are disabled and errors are sanitized.

A fresh turn atomically reserves `(matchId, turn)`, nonce, lease and a new response
idempotency key before any proof/network work. Match commitment is persisted and
cannot silently change mid-match. Exact authenticated retries return recorded
wire bytes; mismatched retries and reused nonces do not repeat side effects.

Only the final transport-selected signed wire outcome is cached, not an early
EXTRACT draft. The original request identity owns its lease; timeout HOLD or a
late worker cannot be overwritten by a concurrent retry. A failure after sending
but before recording leaves a consumed processing row. Network delivery and DB
completion are not falsely described as one atomic transaction.

The request budget begins before upload and uses monotonic time plus the signed
deadline. Aborts are enforced with a race, and the CPU worker is killed on cancel.
Only exact `Finalized` with well-formed job/transaction/block references is trusted;
optimistic success or inclusion is insufficient. No blind retry of an uncertain
submission POST or automatic payment/signature occurs.

## Hosting and dashboard sequence

Use a new DNS name or separate path for this service; keep the Gatekeeper endpoint
and replay data untouched. After configuring DNS and secrets locally:

```sh
docker compose --env-file .env -f deploy/compose.yaml up --build -d
```

Only Caddy exposes ports 80/443; app port 3001 is internal. The app is non-root,
read-only except its volume, capability-restricted and resource bounded. Node and
Caddy image digests are pinned. The container recipe still needs execution on a
Docker-capable host; local Node/Caddy checks are not a built container test.

1. Sign in at the dashboard and register the full `https://host/agent` URL.
2. Choose Steal the VFY; keep one agent per owner for this event.
3. Rotate the secret, store it locally, restart, then run signed dashboard preflight.
4. Run unscored practice with candidate proofs and inspect accepted/rejected
   evidence. Do not turn on scored handling merely because preflight works.
5. Review the public commitment and `v1` circuit version; obtain explicit user
   approval before registering the commitment in My Agents → Edit agent.
6. Register before the tournament's pairing cutoff; the platform freezes it when
   paired. No automatic UI action, registration or freeze is included here.
