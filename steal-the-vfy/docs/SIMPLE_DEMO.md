# Simple Steal the VFY signed-task echo demo

> Experimental transport sketch only. This is **not** the production service, does
> not implement the proof protocol, and does not create a commitment, make a game
> decision, or submit a proof to zkVerify.

## Files

- `simple-demo/server.js` is a deliberately small Express/Node echo server.
- `simple-demo/` contains an independently runnable, pinned experiment.
- The strict HMAC/proof/SQLite implementation remains in `src/`.

## Run the separate demo workspace

Node.js 22 is required. Copy `simple-demo/.env.example` to `simple-demo/.env`,
fill the demo-only HMAC secret locally, and keep that file uncommitted. Its test
starts the echo server as a child process and sends signed local fake-platform
requests. Never put real secrets in test fixtures, chat, or source files.

```sh
# From the repository root; installs the locked root + demo workspace dependencies.
npm ci
npm run demo:test
# Copy simple-demo/.env.example to simple-demo/.env and fill its demo-only secret.
npm run demo:start
```

The demonstrator is a separate Express workspace on loopback. It streams and
bounds request bytes, verifies one constant-time raw-body HMAC before JSON parsing,
and signs its safe allowlisted JSON reply. It is only for transport learning: it
has no turn rules, proof generation, bounded deadline engine, durable replay ledger,
or TLS. Do not expose it publicly, register it for a tournament, or use its reply
as a strategy proof. Use the top-level TypeScript service for strict deployment.

## Canonical production service

The separate production-oriented codebase is at the repository root:
`src/`, `tests/`, `circuits/`, `deploy/`. It pins the official VFY circuit, uses
strict schemas, signed bounded HTTP responses, a durable idempotency ledger,
Poseidon commitment and proof code, and a testnet-only default. Its verified
readiness still fails closed pending accepted platform vectors/live practice.

Root `npm test` runs the strict service tests and demo smoke test; `npm run
typecheck`, `npm run build`, `npm run replay`, and `npm run artifacts:verify` verify
the production-oriented service separately.
