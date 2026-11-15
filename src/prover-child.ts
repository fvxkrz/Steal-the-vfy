import { groth16 } from 'snarkjs';
import { assertBinding, type ProofBundle } from './prover.js';
import type { Artifacts } from './artifacts.js';

process.once('message', async (request: { mode: string; artifacts: Artifacts; witness: Record<string,string|string[]>; expectedSignals: string[]; bundle: ProofBundle }) => {
  try {
    let result: ProofBundle | boolean;
    if (request.mode === 'prove') {
      const generated = await groth16.fullProve(request.witness, request.artifacts.wasm, request.artifacts.zkey, undefined, undefined, { singleThread: true });
      const bundle = { proof: generated.proof, public_signals: generated.publicSignals };
      assertBinding(bundle, request.expectedSignals);
      if (!await groth16.verify(request.artifacts.verificationKey, bundle.public_signals, bundle.proof, undefined, { singleThread: true })) throw new Error('INVALID_PROOF');
      result = bundle;
    } else if (request.mode === 'verify') result = await groth16.verify(request.artifacts.verificationKey, request.bundle.public_signals, request.bundle.proof, undefined, { singleThread: true });
    else throw new Error('INVALID_OPERATION');
    process.send?.({ ok: true, result }, () => process.exit(0));
  } catch { process.send?.({ ok: false }, () => process.exit(1)); }
});
