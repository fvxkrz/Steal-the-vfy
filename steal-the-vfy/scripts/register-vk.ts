import { loadArtifacts } from '../src/artifacts.js';
import { KurierClient } from '../src/zkverify.js';

try {
  if (!process.argv.includes('--confirm-testnet') || !process.env.KURIER_API_KEY ||
      (process.env.ZKVERIFY_NETWORK && process.env.ZKVERIFY_NETWORK !== 'testnet')) throw new Error('NOT_CONFIRMED');
  const artifacts = await loadArtifacts(process.env.ARTIFACTS_DIR || './circuits');
  // Registration sends the public vfy-policy VK to Kurier testnet only; it never
  // signs a wallet transaction or derives/prints private strategy configuration.
  const client = new KurierClient({ network: 'testnet', apiKey: process.env.KURIER_API_KEY, vkHash: '0x' + '00'.repeat(32) });
  const vkHash = await client.registerVk(artifacts.verificationKey, AbortSignal.timeout(30_000));
  process.stdout.write(JSON.stringify({ network: 'testnet', vkHash }) + '\n');
} catch {
  process.stderr.write('vk_registration_unavailable\n'); process.exitCode = 1;
}
