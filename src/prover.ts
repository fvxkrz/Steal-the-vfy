import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Artifacts } from './artifacts.js';

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export interface ProofBundle { proof: Record<string, unknown>; public_signals: string[] }
export type WitnessValue = string | string[];
export interface Prover { prove(witness: Record<string, WitnessValue>, expectedSignals: readonly string[], signal: AbortSignal): Promise<ProofBundle> }
export function assertBinding(bundle: ProofBundle, expected: readonly string[]): void {
  if (bundle.proof.protocol !== 'groth16' || bundle.proof.curve !== 'bn128' || expected.length !== 9 ||
      !Array.isArray(bundle.public_signals) || bundle.public_signals.length !== 9 ||
      bundle.public_signals.some((v, i) => typeof v !== 'string' || !/^(0|[1-9][0-9]{0,76})$/.test(v) || BigInt(v) >= FIELD || v !== expected[i])) throw new Error('PROOF_BINDING_MISMATCH');
}
export class ProcessProver implements Prover {
  constructor(private readonly artifacts: Artifacts) {}
  async prove(witness: Record<string, WitnessValue>, expectedSignals: readonly string[], signal: AbortSignal): Promise<ProofBundle> {
    signal.throwIfAborted();
    for (const v of Object.values(witness)) {
      const values = Array.isArray(v) ? v : [v];
      if (values.some(item => !/^(0|[1-9][0-9]{0,76})$/.test(item) || BigInt(item) >= FIELD)) throw new Error('INVALID_WITNESS');
    }
    const bundle = await this.run({ mode: 'prove', witness, expectedSignals }, signal) as ProofBundle;
    assertBinding(bundle, expectedSignals); return bundle;
  }
  async verify(bundle: ProofBundle, signal: AbortSignal): Promise<boolean> { return (await this.run({ mode: 'verify', bundle }, signal)) === true; }
  private run(request: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const compiled = fileURLToPath(new URL('./prover-child.js', import.meta.url));
    const path = existsSync(compiled) ? compiled : fileURLToPath(new URL('./prover-child.ts', import.meta.url));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=384', ...(path.endsWith('.ts') ? ['--import','tsx'] : []), path],
        { env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production' }, stdio: ['ignore','ignore','ignore','ipc'] });
      let settled = false;
      const finish = (error: Error | null, value?: unknown): void => {
        if (settled) return; settled = true; signal.removeEventListener('abort', abort); child.kill('SIGKILL');
        if (error) reject(error); else resolve(value);
      };
      const abort = (): void => finish(new Error('PROOF_TIMEOUT'));
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) { abort(); return; }
      child.once('error', () => finish(new Error('PROVER_UNAVAILABLE')));
      child.once('exit', () => finish(new Error('PROOF_GENERATION_FAILED')));
      child.once('message', (value: unknown) => {
        if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || !('result' in value)) return finish(new Error('PROOF_GENERATION_FAILED'));
        finish(null, value.result);
      });
      child.send({ ...request, artifacts: this.artifacts }, error => { if (error) finish(new Error('PROVER_UNAVAILABLE')); });
    });
  }
}
