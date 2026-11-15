import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { poseidon3 } from 'poseidon-lite';

// Deliberately public SYNTHETIC fixtures, never production strategy secrets.
const params = ['10', '0', '0', '0', '0', '0', '0', '0'] as const;
const salt = '42';
const commitmentDecimal = '16038997112020182322173448379678790230845526951830566086947884141750627046316';
const commitmentHex = `0x${BigInt(commitmentDecimal).toString(16).padStart(64, '0')}`;

test('Poseidon9 commitment matches the official-circuit synthetic golden vector in fixed-width hex', async () => {
  const module = await import('../src/commitment.js').catch(() => null);
  assert.ok(module, 'exact Poseidon commitment is not implemented');
  assert.equal(module.computeCommitment(params, salt), commitmentHex);
});

test('poseidon-lite Poseidon3 matches the official-circuit synthetic golden vector', () => {
  assert.equal(poseidon3(['123456789', '3', '1']).toString(), '8494069710492800393256547095061428898871226544452344880085629683594646149753');
});

test('commitment rejects noncanonical, out-of-field or non-eight-element inputs without reducing or echoing them', async () => {
  const { computeCommitment } = await import('../src/commitment.js');
  const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const invalidFields: unknown[] = ['', '-1', '+1', '01', ' 42', '42 ', '1.0', '1e2', '0x2a', field.toString(), (field + 42n).toString(), '9'.repeat(1000), 42, null, undefined];
  const sanitized = (error: unknown) => error instanceof Error && error.message === 'STRATEGY_CONFIGURATION';
  for (const value of invalidFields) {
    assert.throws(() => computeCommitment(params, value as string), sanitized);
    assert.throws(() => computeCommitment([value as string, ...params.slice(1)], salt), sanitized);
  }
  for (const invalid of [[], params.slice(0, 7), [...params, '0'], Array<string>(8), null, 'not-an-array']) {
    assert.throws(() => computeCommitment(invalid as readonly string[], salt), sanitized);
  }
  assert.match(computeCommitment([...(params.slice(0, 7)), (field - 1n).toString()], '0'), /^0x[0-9a-f]{64}$/);
});

test('missing private parameters and salt leave strategy unavailable, even if a public commitment is supplied', async () => {
  const module = await import('../src/commitment.js');
  assert.equal(typeof module.loadStrategyConfig, 'function', 'private environment configuration is not implemented');
  assert.equal(module.loadStrategyConfig({}), undefined);
  assert.equal(module.loadStrategyConfig({ STRATEGY_COMMITMENT: commitmentHex }), undefined);
});

test('explicit private environment values derive the v1 commitment without changing the selected parameters', async () => {
  const { loadStrategyConfig } = await import('../src/commitment.js');
  const env = { STRATEGY_PARAMS_JSON: JSON.stringify(params), STRATEGY_SALT: salt };
  assert.deepEqual(loadStrategyConfig(env), { params, salt, commitment: commitmentHex, circuitVersion: 'v1' });
  assert.deepEqual(env, { STRATEGY_PARAMS_JSON: JSON.stringify(params), STRATEGY_SALT: salt });
});

test('partial or malformed private environment configuration throws only the sanitized configuration error', async () => {
  const { loadStrategyConfig } = await import('../src/commitment.js');
  const good = { STRATEGY_PARAMS_JSON: JSON.stringify(params), STRATEGY_SALT: salt };
  const cases = [
    { STRATEGY_PARAMS_JSON: good.STRATEGY_PARAMS_JSON }, { STRATEGY_SALT: salt },
    { ...good, STRATEGY_PARAMS_JSON: 'private-invalid-json-marker' },
    ...['', 'null', '{}', '[]', '[10,0,0,0,0,0,0,0]', '["10","0","0","0","0","0","0"]', '["10","0","0","0","0","0","0","00"]'].map(STRATEGY_PARAMS_JSON => ({ ...good, STRATEGY_PARAMS_JSON })),
    ...['', ' 42', '42 ', '-1', '042', '0x2a', '21888242871839275222246405745257275088548364400416034343698204186575808495617'].map(STRATEGY_SALT => ({ ...good, STRATEGY_SALT })),
  ];
  for (const env of cases) {
    assert.throws(() => loadStrategyConfig(env), (error: unknown) => error instanceof Error && error.message === 'STRATEGY_CONFIGURATION');
  }
});

test('private configuration cannot silently replace the user-approved fixed aggressive policy', async () => {
  const { loadStrategyConfig } = await import('../src/commitment.js');
  for (let index = 0; index < 8; index++) {
    const different = [...params] as string[];
    different[index] = index === 0 ? '9' : '1';
    assert.throws(() => loadStrategyConfig({ STRATEGY_PARAMS_JSON: JSON.stringify(different), STRATEGY_SALT: salt }),
      (error: unknown) => error instanceof Error && error.message === 'STRATEGY_CONFIGURATION');
  }
});

test('optional registered public commitment must match the exact derived fixed-width representation', async () => {
  const { loadStrategyConfig } = await import('../src/commitment.js');
  const env = { STRATEGY_PARAMS_JSON: JSON.stringify(params), STRATEGY_SALT: salt };
  assert.equal(loadStrategyConfig({ ...env, STRATEGY_COMMITMENT: commitmentHex })?.commitment, commitmentHex);
  for (const STRATEGY_COMMITMENT of ['', '0x00', `0x${'00'.repeat(32)}`, commitmentHex.toUpperCase(), commitmentDecimal]) {
    assert.throws(() => loadStrategyConfig({ ...env, STRATEGY_COMMITMENT }),
      (error: unknown) => error instanceof Error && error.message === 'STRATEGY_CONFIGURATION');
  }
});

test('commitment CLI prints only the derived public hash and fails closed without private env values', () => {
  const script = fileURLToPath(new URL('../scripts/commitment.ts', import.meta.url));
  assert.equal(existsSync(script), true, 'commitment CLI is not implemented');
  const missing = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { PATH: process.env.PATH } });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout.toString(), '');
  assert.equal(missing.stderr.toString().trim(), 'commitment_unavailable');
  const present = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, STRATEGY_PARAMS_JSON: JSON.stringify(params), STRATEGY_SALT: salt } });
  assert.equal(present.status, 0);
  assert.equal(present.stdout.toString(), `${commitmentHex}\n`);
  assert.equal(present.stderr.toString(), '');
  const invalid = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, STRATEGY_PARAMS_JSON: '["private-invalid"]', STRATEGY_SALT: salt } });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout.toString(), '');
  assert.equal(invalid.stderr.toString().trim(), 'commitment_unavailable');
});
