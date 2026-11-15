import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnStore } from '../src/store.js';
import { sampleTurn } from './fixtures.js';
import { publicInputsHash } from '../src/public-hash.js';
import { poseidon3, poseidon9 } from 'poseidon-lite';
import type { StrategyConfig } from '../src/commitment.js';

// Explicit PUBLIC synthetic configuration used only by tests, never default production secrets.
const params = ['10','0','0','0','0','0','0','0'];
const strategy: StrategyConfig = { params, salt: '42', commitment: ('0x' + poseidon9([...params, '42']).toString(16).padStart(64,'0')) as `0x${string}`, circuitVersion: 'v1' };
function configuredTurn(patch: Partial<ReturnType<typeof sampleTurn>> = {}) { return sampleTurn({ strategyCommitment: { hash: strategy.commitment }, ...patch }); }
const localProof = { prove: async (w: Record<string,string|string[]>, expected: readonly string[]) => ({ proof: { protocol: 'groth16', curve: 'bn128' }, public_signals: [...expected] }) };
const finalized = { jobId: 'MOCKED_ONLY', status: 'Finalized' as const, txHash: '0x'+'ab'.repeat(32), blockHash: '0x'+'cd'.repeat(32) };

test('competition mode stays HOLD even with all local candidate proof dependencies configured', async () => {
  const { createEngine } = await import('../src/engine.js'); const store = new TurnStore(':memory:');
  try {
    let calls=0;
    const engine=createEngine({ store, strategy, prover: { prove: async () => { calls++; throw Error('not permitted'); } }, finalizer: { finalize: async () => finalized } });
    const turn=configuredTurn({mode:'competition'});
    const out=await engine.handle(turn,Buffer.from(JSON.stringify(turn)),AbortSignal.timeout(1000));
    assert.equal(typeof out,'object'); if(typeof out==='string')return;
    assert.deepEqual(out.action,{type:'HOLD'});assert.equal(out.proof,undefined);assert.equal(calls,0);assert.equal(engine.ready(),false);
  }finally{store.close();}
});

test('a failed finalization returns proof-less HOLD, records the wire choice and never resubmits on retry', async () => {
  const { createEngine } = await import('../src/engine.js'); const store = new TurnStore(':memory:');
  try {
    let calls=0;
    const engine=createEngine({store,strategy,prover:localProof,finalizer:{finalize:async()=>{calls++;throw Error('MOCKED failure');}}});
    const turn=configuredTurn();const raw=Buffer.from(JSON.stringify(turn));const signal=AbortSignal.timeout(5000);
    const out=await engine.handle(turn,raw,signal);assert.equal(typeof out,'object');if(typeof out==='string')return;
    assert.deepEqual(out.action,{type:'HOLD'});assert.equal(out.proof,undefined);assert.equal(calls,1);
    engine.onOutcome(turn,raw,signal,JSON.stringify(out));
    assert.equal(await engine.handle(turn,raw,AbortSignal.timeout(1000)),JSON.stringify(out));assert.equal(calls,1);
  }finally{store.close();}
});

for(const status of ['IncludedInBlock','FINALIZED','Failed']) {
  test(`new proof ${status} never releases an EXTRACT`, async()=>{
    const {createEngine}=await import('../src/engine.js');const store=new TurnStore(':memory:');
    try{
      const engine=createEngine({store,strategy,prover:localProof,finalizer:{finalize:async()=>({...finalized,status}) as typeof finalized}});
      const turn=configuredTurn();const out=await engine.handle(turn,Buffer.from(JSON.stringify(turn)),AbortSignal.timeout(1000));
      assert.equal(typeof out,'object');if(typeof out==='string')return;assert.deepEqual(out.action,{type:'HOLD'});assert.equal(out.proof,undefined);
    }finally{store.close();}
  });
}

test('missing private strategy produces a schema-valid hashed HOLD without proof work', async () => {
  const module = await import('../src/engine.js').catch(() => null);
  assert.ok(module && 'createEngine' in module, 'durable safe Steal engine is not implemented');
  const store = new TurnStore(':memory:');
  try {
    let calls = 0;
    const engine = module.createEngine({ store, prover: { prove: async () => { calls++; throw new Error('must not prove'); } } });
    const turn = sampleTurn(); const raw = Buffer.from(JSON.stringify(turn)); const signal = AbortSignal.timeout(5000);
    const response = await engine.handle(turn, raw, signal);
    assert.equal(typeof response, 'object'); if (typeof response === 'string') return;
    assert.deepEqual(response.action, { type: 'HOLD' }); assert.equal(response.proof, undefined);
    assert.equal(response.policyProof.publicInputsHash, publicInputsHash(turn, { type: 'HOLD' }));
    engine.onOutcome(turn, raw, signal, JSON.stringify(response));
    const retry = await engine.handle(turn, raw, AbortSignal.timeout(5000));
    assert.equal(retry, JSON.stringify(response)); assert.equal(calls, 0); assert.equal(engine.ready(), false);
  } finally { store.close(); }
});
