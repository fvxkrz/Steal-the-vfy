import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('local replay exercises signed HTTP, the official circuit and mocked Kurier finality', () => {
  const result = spawnSync(process.execPath, ['--import','tsx','scripts/replay.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split(String.fromCharCode(10)).find(value => value.startsWith('{"event":"steal_vfy_local_replay_passed"'));
  assert.ok(line, result.stdout);
  const data = JSON.parse(line);
  assert.equal(data.event, 'steal_vfy_local_replay_passed');
  assert.equal(data.realProofsVerified, 1);
  assert.equal(data.finalizer, 'MOCKED_ONLY');
  assert.equal(data.platformAcceptance, 'UNVERIFIED');
});
