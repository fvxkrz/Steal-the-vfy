# Official vfy-policy circuit: independently witnessed local analysis

## Scope and provenance
Research only. No production source, dependencies, registration, signing, or proof submission were changed. All numeric policy parameters, salts, match identifiers and witnesses used below are deliberately PUBLIC SYNTHETIC TEST FIXTURES; none are the user's production policy secrets.

Authoritative URLs: https://agentgames.zkverify.io/build ; https://agentgames.zkverify.io/api/circuit-info ; https://agentgames.zkverify.io/circuits/vfy-policy.wasm ; https://agentgames.zkverify.io/circuits/vfy-policy_final.zkey . Official event timing is 5 minutes per turn, approximately 30 seconds per push (saved event page lines 26–27 and 107), not the Gatekeeper 60-second example.

Rechecked artifact SHA256:
- WASM: bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2
- zkey: f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41

Published MAINNET VK hash: 0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047 . The local exported VK is Groth16/bn128, nPublic=9. This analysis does not compute a zkVerify VK registration hash or independently confirm the published chain registration.

Requests for `/circuits/vfy-policy.circom`, `.sym`, `.r1cs` each returned HTTP 404. Names were recovered by FNV-1a64 lookups through the actual WASM `getInputSignalSize`, not borrowed encodings. The compiler getters report Circom 2.2.3, getInputSize=17, getWitnessSize=1909. A bounded 1617-candidate probe found the complete arity: nine scalars plus eight array elements.

## Exact witnessed input schema

Scalar names, each size 1:
`commitment`, `matchId`, `turnNumber`, `selfBalance`, `opponentBalance`, `action`, `amount`, `circuitVersion`, `salt`.

Array: `strategyParams`, exactly 8 elements.

Important: `turn` is NOT a witness input name; `turnNumber` is. No fortified-until state is an input of this artifact. JSON object insertion order is not the cryptographic public-signal order.

The exact 9-element snarkjs publicSignals order, checked against real fullProve outputs:

0. output = Poseidon3([matchId, turnNumber, circuitVersion])
1. commitment
2. matchId
3. turnNumber
4. selfBalance
5. opponentBalance
6. action
7. amount
8. circuitVersion

The output name itself cannot be recovered without symbols; `output` above is a descriptive label, not a claimed original Circom signal identifier. The first output is NOT a hash of the full state/action; it stays unchanged when commitment, balances, action or amount change with the same match/turn/version. Those fields are instead separately exposed as public signals.

## Verified commitment relation

`commitment = Poseidon9([strategyParams[0], strategyParams[1], strategyParams[2], strategyParams[3], strategyParams[4], strategyParams[5], strategyParams[6], strategyParams[7], salt])`.

This matches installed circomlibjs 0.1.7 on all 110 successful witness fixtures; output Poseidon3 also matches on all 110. Changing the supplied commitment, salt, or any parameter while holding the prior commitment fixed rejected at circuit line 72. The reverse salt-first candidate also rejected there. Reserved p4–p7 are still included in commitment although valid fixtures require zero.

Synthetic reproducible example (not a production strategy choice): params [10,0,0,0,0,0,0,0], salt 42, matchId 123456789, turnNumber 3, selfBalance 95, opponentBalance 105, action 2, amount 10, circuitVersion 1.

Commitment: 16038997112020182322173448379678790230845526951830566086947884141750627046316.
Output: 8494069710492800393256547095061428898871226544452344880085629683594646149753.

No poseidon-lite dependency was installed or compared here. A replacement must match these official-circuit/circomlibjs vectors, including 9-input and 3-input variants, before replacing the oracle.

## Observed fixed policy semantics

For the successfully tested nonnegative ordinary game domain, every accepted fixture matches this deterministic rule:

```
if selfBalance < strategyParams[1]:
    action = 1  # FORTIFY
elif opponentBalance > strategyParams[2] and strategyParams[3] == 0:
    action = 2  # EXTRACT
else:
    action = 0  # HOLD
amount = strategyParams[0] if action == 2 else 0
```

Names such as extraction request, fortify threshold, opponent threshold and disable-extract flag are inferred descriptive names, NOT published parameter names. The artifact is a fixed parameterized policy, not an arbitrary committed program. These are empirical semantics backed by boundary probes, not a formal proof of all finite-field behavior.

Restrictions directly observed:
- p0 accepts every integer 1 through 10. 0 rejects at line 90; 11 and 15/16 reject at line 95; larger tested values can fail the comparator's bit constraints first.
- p3 accepts 0/1; 2 and larger tested values reject at line 98. p3=1 disables extraction but does NOT disable a higher-priority fortify decision. This behavior is the same on tested turns 0,1,2,3,4,5,19,20.
- p4,p5,p6,p7 each reject a nonzero value at lines 75,76,77,78 respectively.
- p1 boundary self=95: threshold95 extracts, threshold96 fortifies. p2 boundary opponent=105: threshold105 holds, threshold96 extracts. Thus self comparison is strict <, opponent comparison strict >.
- p1/p2 tested values 0,1,2,10,20,100,65535,65536 can be valid; very large threshold/balance cases fail Num2Bits in comparisons. Do NOT assert a simple uint16 cap: 65536 was actually accepted. Exact global comparator domains were not formally recovered.
- turn 0,21,65536 and synthetic uint128-max turn/version/match identifiers can witness successfully. The circuit does not itself enforce match turn1..20, circuitVersion1, or valid UUID syntax. Enforce protocol constraints outside the circuit.
- The circuit can prove FORTIFY even with selfBalance0 or1. It does not enforce affordability of the published 2-VFY cost.

## User-selected aggressive policy compatibility

The synthetic params [10,0,0,0,0,0,0,0] represent, on the tested ordinary domain: EXTRACT requested amount10 whenever opponentBalance>0; HOLD amount0 when opponentBalance=0; never FORTIFY. This expresses the selected high-level maximum-extraction policy IF the platform permits requesting10 when fewer than10 are available and clips the effective transfer, as the public build guide's "steals up to N" wording suggests. This does not choose or register the user's final private parameters/salt.

CRITICAL: the circuit does NOT calculate `min(10, opponentBalance)`. With opponentBalance1 or5 it accepts EXTRACT amount10 and rejects the attempted amount1 or5 for this same commitment. Real fullProve+verify proofs were produced for opponent1 and5 with amount10. Do not silently implement a clipped requested amount: it would fail this circuit. If the platform instead requires amount<=opponent spendable balance, this fixed artifact and this max-request policy are incompatible on those states; obtain official resolver/accepted-practice confirmation rather than asserting compatibility.

The circuit forces HOLD when opponentBalance0 for these parameters. No fortification state is proved, and amount10 is a request, not guaranteed gain. Opponent shielding and spendable balance resolution remain platform responsibilities. A user policy requiring action/amount decisions based on fortified-until fields cannot generally be expressed by this artifact's actual input schema.

Wrong action, wrong amount and stale public state cannot simply be attached to an existing proof: all nine single-public-signal mutations rejected local groth16.verify. However an independently generated proof for an incorrect but circuit-admissible state is locally valid; only the platform's comparison with the signed real game state prevents lying about that state.

## Hash binding and authoritative gaps

The official Keccak publicInputsHash is Keccak256 of eight concatenated big-endian 32-byte fields, in order `[commitment, uuidAsUint128, turn, selfBalance, opponentBalance, action0or1or2, amount0ForNonExtract, circuitVersion1]`. That official recipe supplies the UUID integer conversion and action/version numeric map for the public hash.

For the synthetic numeric example the recipe yields `0xb4f366c80484380d513b716bf241fb3bdd734547a2c76ad65abe88209b1b362d`. Poseidon8 of those fields is 14936022366091775705362447125406353460743469028198278261042103233626158740418, which is neither the circuit output nor that Keccak value. Do not substitute one for another.

Not established by this work:
- Platform's accepted witness-to-envelope comparison, including explicit confirmation its matchId witness uses the same UUID integer as the public hash. The official public-hash encoding does NOT automatically establish this private adapter contract.
- Accepted on-wire registration representation of the Poseidon field commitment (fixed-width hex vs other representation), or an accepted full proof/9-signals practice vector. Public examples use abbreviated hashes, not a conformance vector.
- Whether platform low-balance extraction legality caps the requested amount or only the resolver's effective transfer; fortified/spendable state semantics are absent from the circuit input map.
- Actual original .circom parameter names, exact complete numeric domains, or formal unconstrained-signal audit.
- Live platform acceptance, Kurier finality, testnet registration, mainnet VK hash derivation, production latency/load, and poseidon-lite equivalence. None were attempted; no credentials were used.

The guide itself inconsistently describes publicInputsHash as optional in one paragraph and mandatory in common-mistakes text; sending the documented correctly computed value is prudent, but does not eliminate the missing accepted-platform vector.

## Execution evidence and artifacts

All files are under `<research-scratch>/`.

- `discover-inputs.mjs`, `input-discovery.json`: exact input names/arity/compiler getters.
- `initial-probe.mjs`, `initial-probes.json`: initial ordering and parameter-invalid attempts.
- `parameter-probe.mjs`, `parameter-probes.json`: parameter basis probes.
- `synthetic-extract-input.json`, `synthetic-extract-witness.json`, `synthetic-extract-proof.json`: actual numeric witness (1909 entries), Groth16 proof, nine public signals and verified:true.
- `semantic-probe.mjs`, `semantic-probes.json`, `semantic-proofs.json`, `semantic-summary.json`: state/action/amount/parameter probes and nine rejected public-signal mutations.
- `focused-probe.mjs`, `focused-probes.json`, `focused-proofs.json`, `focused-summary.json`: low-balance actual amount10 proofs, threshold boundaries, commitment salts, Poseidon3 discovery.
- `final-probe.mjs`, `final-probes.json`, `final-proofs.json`, `aggregate-summary.json`: disable-extract and range probes plus complete programmatic counts and cross-vector hash checks.
- `verification_key.json`: exported from the pinned zkey.
- `binding-comparison.json`: initial negative comparison against Poseidon8 and the independent Keccak recipe.

Programmatically counted: 469 witness attempts, 110 accepted, 359 rejected; 11 actual fullProve proofs and 11 successful local groth16.verify checks; 9 modified-public-signal verifications all rejected. All110 accepted fixtures matched Poseidon9 commitment, Poseidon3 output, and the described deterministic decision predicate. Repeated fixtures are counted as test attempts, not unique vectors. Every accepted fixture does NOT have its own proof; the11 separately generated proofs cover ordinary extraction, depleted-opponent HOLD, low-balance requests, fortify, disable-extract HOLD, salt change and unaffordable fortify.

To rerun a batch with the existing dependencies only:
`WASM_PATH=<research-scratch>/wasm node <research-scratch>/focused-probe.mjs`

The scripts intentionally end with process.exit because snarkjs worker/MessagePort handles can otherwise keep a one-shot research process alive.
