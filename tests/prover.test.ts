import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadArtifacts } from '../src/artifacts.js';

test('the isolated VFY prover rejects an already cancelled operation before starting CPU work', async () => {
  const module = await import('../src/prover.js').catch(() => null);
  assert.ok(module, 'isolated VFY snarkjs worker is not implemented');
  const artifacts = await loadArtifacts(fileURLToPath(new URL('../circuits', import.meta.url)));
  const prover = new module.ProcessProver(artifacts);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prover.prove({}, [], controller.signal));
});
