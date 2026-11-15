import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('only the official VFY policy artifacts and their 9-public-input VK are loaded', async () => {
  const module = await import('../src/artifacts.js').catch(() => null);
  assert.ok(module, 'VFY artifact integrity loader is not implemented');
  const dir = fileURLToPath(new URL('../circuits', import.meta.url));
  const key = await module.loadArtifacts(dir);
  assert.equal(key.verificationKey.protocol, 'groth16'); assert.equal(key.verificationKey.nPublic, 9);
  const temp = await mkdtemp(join(tmpdir(), 'vfy-artifact-test-'));
  try {
    await cp(dir, temp, { recursive: true });
    const bytes = await readFile(join(temp, 'vfy-policy.wasm')); bytes[bytes.length-1] = bytes[bytes.length-1]! ^ 1;
    await writeFile(join(temp, 'vfy-policy.wasm'), bytes);
    await assert.rejects(module.loadArtifacts(temp), /ARTIFACT_INTEGRITY/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
