import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

test('VFY config requires the dashboard secret, defaults testnet and keeps push work below thirty seconds', async () => {
  const module = await import('../src/config.js').catch(() => null);
  assert.ok(module, 'bounded Steal configuration is not implemented');
  assert.throws(() => module.loadConfig({}), /CONFIGURATION/);
  const env = { AGENT_GAMES_HMAC_SECRET: randomBytes(32).toString('hex') };
  const config = module.loadConfig(env);
  assert.equal(config.network, 'testnet'); assert.equal(config.responseBudgetMs, 25_000);
  assert.equal(config.maxTaskAgeMs, 300_000); assert.equal(config.port, 3001);
  assert.throws(() => module.loadConfig({ ...env, RESPONSE_BUDGET_MS: '30000' }), /CONFIGURATION/);
  assert.throws(() => module.loadConfig({ ...env, ZKVERIFY_NETWORK: 'mainnet' }), /CONFIGURATION/);
  assert.throws(() => module.loadConfig({ ...env, AGENT_PATH: '/readyz' }), /CONFIGURATION/);
});
