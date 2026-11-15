import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('entrypoint refuses missing dashboard secret without leaking environment or stack details', () => {
  const result = spawnSync(process.execPath, ['--import','tsx','src/main.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'service_startup_failed\n');
});
