import { resolve } from 'node:path';
import { MAINNET_VK_HASH } from './artifacts.js';
import type { Network } from './zkverify.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const fail = (): never => { throw new Error('CONFIGURATION_INVALID'); };
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name]; if (raw !== undefined && !/^[0-9]+$/.test(raw)) return fail();
    const v = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(v) || v < min || v > max) return fail(); return v;
  };
  const secret = env.AGENT_GAMES_HMAC_SECRET;
  if (!secret || secret.length < 32 || secret.length > 1024 || /^(changeme|placeholder|example|test-secret)/i.test(secret)) return fail();
  const network = env.ZKVERIFY_NETWORK ?? 'testnet';
  if (network !== 'testnet' && network !== 'mainnet') return fail();
  if (network === 'mainnet' && env.ALLOW_MAINNET !== 'true') return fail();
  const vkHash = env.KURIER_VK_HASH || undefined;
  if (vkHash && !/^0x[0-9a-fA-F]{64}$/.test(vkHash)) return fail();
  if (network === 'mainnet' && vkHash?.toLowerCase() !== MAINNET_VK_HASH) return fail();
  const agentPath = env.AGENT_PATH ?? '/agent';
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(agentPath) || agentPath.includes('//') || ['/healthz','/readyz'].includes(agentPath)) return fail();
  return { secret, network: network as Network, vkHash, apiKey: env.KURIER_API_KEY || undefined,
    host: env.HOST ?? '127.0.0.1', port: integer('PORT', 3001, 1, 65535), agentPath,
    artifactsDir: resolve(env.ARTIFACTS_DIR || './circuits'), dbPath: resolve(env.DB_PATH || './data/steal.sqlite'),
    bodyLimit: integer('BODY_LIMIT_BYTES', 65536, 1024, 262144), responseBudgetMs: integer('RESPONSE_BUDGET_MS', 25000, 1000, 29000),
    proofTimeoutMs: integer('PROOF_TIMEOUT_MS', 12000, 100, 20000), maxInFlight: integer('MAX_IN_FLIGHT', 1, 1, 4),
    maxTaskAgeMs: integer('MAX_TASK_AGE_MS', 300000, 1000, 300000), clockSkewMs: integer('CLOCK_SKEW_MS', 5000, 0, 5000) };
}
