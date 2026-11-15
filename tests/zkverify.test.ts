import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const hash = '0x' + 'ab'.repeat(32);
const proof = { protocol: 'groth16', curve: 'bn128', pi_a: ['1','2','1'], pi_b: [['1','2'],['3','4'],['1','0']], pi_c: ['1','2','1'] };
test('Kurier accepts HTTP 202, polls past inclusion and returns only exact Finalized evidence', async () => {
  const module = await import('../src/zkverify.js').catch(() => null);
  assert.ok(module, 'Kurier finality client is not implemented');
  const apiKey = randomBytes(24).toString('hex');
  const calls: { url: string; body?: unknown }[] = [];
  let polls = 0;
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (init?.method === 'POST') return Response.json({ jobId: 'local-job', status: 'pending' }, { status: 202 });
    return Response.json({ jobId: 'local-job', status: ++polls === 1 ? 'IncludedInBlock' : 'Finalized', txHash: hash, blockHash: hash, proofType: 'groth16', errorDetails: null });
  };
  const client = new module.KurierClient({ network: 'testnet', apiKey, vkHash: hash, pollIntervalMs: 1, fetchImpl: fakeFetch });
  const result = await client.finalize({ proof, public_signals: ['1'] }, AbortSignal.timeout(1000));
  assert.equal(result.txHash, hash);
  assert.equal(result.status, 'Finalized');
  assert.equal(polls, 2);
  assert.equal(calls[0]?.url, `https://api-testnet.kurier.xyz/api/v1/submit-proof/${apiKey}`);
  assert.equal(calls[1]?.url, `https://api-testnet.kurier.xyz/api/v1/job-status/${apiKey}/local-job`);
  assert.deepEqual(calls[0]?.body, { proofType: 'groth16', vkRegistered: true, proofOptions: { library: 'snarkjs', curve: 'bn128' },
    proofData: { proof, publicSignals: ['1'], vk: hash } });
});

for (const status of ['Valid', 'Submitted', 'IncludedInBlock', 'FINALIZED', 'Failed', 'Aggregated']) {
  test(`Kurier never treats ${status} as finality`, async () => {
    const { KurierClient } = await import('../src/zkverify.js');
    const key = randomBytes(24).toString('hex');
    const fakeFetch: typeof fetch = async (_url, init) => init?.method === 'POST'
      ? Response.json({ jobId: 'local-job', optimisticVerify: 'success' })
      : Response.json({ jobId: 'local-job', status, txHash: hash, blockHash: hash });
    const client = new KurierClient({ network: 'testnet', apiKey: key, vkHash: hash, pollIntervalMs: 1, fetchImpl: fakeFetch });
    await assert.rejects(client.finalize({ proof, public_signals: ['1'] }, AbortSignal.timeout(25)));
  });
}

test('provider errors containing a secret-bearing URL are replaced by safe error codes', async () => {
  const { KurierClient } = await import('../src/zkverify.js');
  const key = randomBytes(24).toString('hex');
  const client = new KurierClient({ network: 'testnet', apiKey: key, vkHash: hash,
    fetchImpl: async (url) => { throw new Error(String(url)); } });
  try { await client.finalize({ proof, public_signals: ['1'] }, AbortSignal.timeout(1000)); assert.fail('must reject'); }
  catch (error) { assert.ok(error instanceof Error); assert.equal(error.message.includes(key), false); assert.equal(error.message, 'KURIER_UNAVAILABLE'); }
});
