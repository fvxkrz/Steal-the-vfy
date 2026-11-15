import { setTimeout as delay } from 'node:timers/promises';
import type { ProofBundle } from './prover.js';

export type Network = 'testnet' | 'mainnet';
export const KURIER_BASE = Object.freeze({ testnet: 'https://api-testnet.kurier.xyz/api/v1', mainnet: 'https://api.kurier.xyz/api/v1' });
export interface FinalizedEvidence { jobId: string; status: 'Finalized'; txHash: string; blockHash: string }
export interface Finalizer { finalize(bundle: ProofBundle, signal: AbortSignal): Promise<FinalizedEvidence> }
interface Options { network: Network; apiKey: string; vkHash: string; pollIntervalMs?: number; fetchImpl?: typeof fetch }
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;

export class KurierClient implements Finalizer {
  private readonly fetchImpl: typeof fetch;
  private readonly interval: number;
  constructor(private readonly options: Options) {
    if (!KURIER_BASE[options.network] || !options.apiKey || options.apiKey.length > 512 || !HASH.test(options.vkHash)) throw new Error('KURIER_CONFIGURATION');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.interval = options.pollIntervalMs ?? 1000;
    if (!Number.isSafeInteger(this.interval) || this.interval < 1 || this.interval > 5000) throw new Error('KURIER_CONFIGURATION');
  }
  async finalize(bundle: ProofBundle, signal: AbortSignal): Promise<FinalizedEvidence> {
    const accepted = await this.request('POST', '/submit-proof', signal, {
      proofType: 'groth16', vkRegistered: true, proofOptions: { library: 'snarkjs', curve: 'bn128' },
      proofData: { proof: bundle.proof, publicSignals: bundle.public_signals, vk: this.options.vkHash },
    });
    if (typeof accepted.jobId !== 'string' || !ID.test(accepted.jobId) || accepted.optimisticVerify === 'failed' || accepted.error) throw new Error('VERIFICATION_FAILED');
    const jobId = accepted.jobId;
    while (true) {
      signal.throwIfAborted();
      const job = await this.request('GET', '/job-status', signal, undefined, jobId);
      if (job.jobId !== jobId || typeof job.status !== 'string' || job.errorDetails ||
          (job.proofType !== undefined && job.proofType !== null && job.proofType !== 'groth16')) throw new Error('VERIFICATION_FAILED');
      if (job.status === 'Finalized') {
        if (typeof job.txHash !== 'string' || !HASH.test(job.txHash) || typeof job.blockHash !== 'string' || !HASH.test(job.blockHash)) throw new Error('FINALITY_UNCONFIRMED');
        signal.throwIfAborted();
        return { jobId, status: 'Finalized', txHash: job.txHash.toLowerCase(), blockHash: job.blockHash.toLowerCase() };
      }
      if (!['Queued', 'Valid', 'Submitted', 'IncludedInBlock'].includes(job.status)) throw new Error('FINALITY_UNCONFIRMED');
      await delay(this.interval, undefined, { signal });
    }
  }
  async registerVk(vk: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    const result = await this.request('POST', '/register-vk', signal, {
      proofType: 'groth16', proofOptions: { library: 'snarkjs', curve: 'bn128' }, vk,
    });
    if (typeof result.vkHash !== 'string' || !HASH.test(result.vkHash)) throw new Error('VK_REGISTRATION_UNCONFIRMED');
    return result.vkHash.toLowerCase();
  }
  private async request(method: string, path: string, signal: AbortSignal, body?: unknown, jobId?: string): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    const url = `${KURIER_BASE[this.options.network]}${path}/${encodeURIComponent(this.options.apiKey)}${jobId ? '/' + encodeURIComponent(jobId) : ''}`;
    try {
      // The provider puts API keys in paths: never log this URL, errors, response bodies, or redirects.
      const response = await this.fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!(response.status === 200 || (path === '/submit-proof' && response.status === 202))) throw new Error('KURIER_UNAVAILABLE');
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > 262144) throw new Error('KURIER_RESPONSE_INVALID');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('KURIER_RESPONSE_INVALID');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 262144) { await reader.cancel(); throw new Error('KURIER_RESPONSE_INVALID'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('KURIER_RESPONSE_INVALID');
      return result as Record<string, unknown>;
    } catch {
      throw new Error(signal.aborted ? 'VERIFICATION_TIMEOUT' : 'KURIER_UNAVAILABLE');
    }
  }
}
