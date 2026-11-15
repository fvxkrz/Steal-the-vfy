import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('artifact CLI verifies the VFY files without credentials', () => {
  const p = spawnSync(process.execPath, ['--import','tsx','scripts/artifacts.ts','verify'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10_000 });
  assert.equal(p.status, 0); assert.match(p.stdout, /vfy_artifacts_verified/); assert.equal(p.stderr, '');
});

test('commitment CLI prints only a public hash and requires local private params plus salt', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const missing = spawnSync(process.execPath, ['--import','tsx','scripts/commitment.ts'], { cwd, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(missing.status, 1); assert.equal(missing.stdout, ''); assert.equal(missing.stderr, 'commitment_unavailable' + String.fromCharCode(10));
  const params = ['10','0','0','0','0','0','0','0']; const salt = '42';
  const result = spawnSync(process.execPath, ['--import','tsx','scripts/commitment.ts'], { cwd,
    env: { PATH: process.env.PATH ?? '', STRATEGY_PARAMS_JSON: JSON.stringify(params), STRATEGY_SALT: salt }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stdout.length, 67); assert.equal(result.stdout.startsWith('0x'), true);
  assert.equal(result.stdout.includes(salt), false); assert.equal(result.stdout.includes(JSON.stringify(params)), false);
});

test('testnet VK registration script has an explicit opt-in and no default credential', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(process.execPath, ['--import','tsx','scripts/register-vk.ts'], { cwd,
    env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'vk_registration_unavailable' + String.fromCharCode(10));
});
