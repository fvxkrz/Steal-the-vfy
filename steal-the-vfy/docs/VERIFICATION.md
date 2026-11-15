# Steal the VFY — implementation verification

## Executed locally

- Strict typecheck: passed.
- Test suite: **65/65** strict TypeScript service tests plus **1/1** Express demo
  subprocess test (raw HMAC-before-JSON, signed responses, altered payload,
  compression rejection); `npm test` runs both suites from the root workspace.
- TypeScript build: passed.
- Production dependency audit (`npm audit --omit=dev`): zero reported advisories.
- Caddy configuration validation: passed.
- Independent security review of the final strict service and Express demo: passed,
  with no reported security concerns or logic errors. The reviewer noted only
  optional hardening for the loopback-only educational demo: faster abort of
  oversized uploads and bounded child-process test shutdown.
- Local replay returned `steal_vfy_local_replay_passed`: one real Groth16 proof
  verified for a synthetic practice turn (opponent balance 5, requested amount 10),
  signed HTTP response verified, retry returned identical cached bytes. The replay
  explicitly labels `finalizer=MOCKED_ONLY`, `platformAcceptance=UNVERIFIED`, and
  `competitionReady=false`; no Kurier network call occurred.
- Fresh production-only installation (`npm ci --omit=dev`): passed with no tsx
  dependency and zero audit advisories. The compiled ESM service generated and
  verified a real official-circuit proof, passed signed preflight, and kept
  readiness blocked. This was a local smoke, not Docker or platform preflight.
- Caddy configuration validation: passed.
- `.env.example` secrets are blank and both root and demo `.env` paths are ignored.
  No API key, real HMAC secret, production strategy salt, wallet key or commitment
  registration was used.

## Independent circuit evidence

`docs/circuit-analysis.md` records the exact locally recovered witness/public-signal mapping, Poseidon commitment relation and user-selected strategy semantics. Research used only public synthetic numeric test vectors. Eleven separate real Groth16 proofs locally verified; 9/9 signal mutations rejected. This establishes local circuit validity, not accepted platform encoding, commitment registration representation, or match-state resolver correctness.

## Activation still blocked

- No accepted platform conformance vector confirms the UUID/matchId witness conversion, public signals and registration's commitment representation.
- Platform practice has not confirmed request EXTRACT 10 at opponent balance 1–9, even though the official local circuit proves it. The resolver's realized transfer behavior still requires practice evidence.
- No actual testnet VK registration, finalized Kurier job, dashboard preflight or public HTTPS deployment occurred.
- No strategy commitment was registered/frozen. The endpoint remains deliberately practice-only; scored turns receive HOLD and readiness is false.
- Docker is unavailable in this environment, so the pinned Docker image and GitHub Actions container job have not run here.

Do not present the mocked finalizer replay as live finality or the proof as a platform-accepted practice result. The strategy cannot be activated for scored rounds until every blocker is resolved and reviewed.
