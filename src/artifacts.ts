import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

export const OFFICIAL_ARTIFACTS = Object.freeze({
  'vfy-policy.wasm': 'bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2',
  'vfy-policy_final.zkey': 'f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41',
  'verification_key.json': '52c62758fa85edc7aa52318a8bdb495b9da8deaa7a2e8a25fd8c7e5669bb07f3',
});
export const MAINNET_VK_HASH = '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047';
export interface Artifacts { wasm: string; zkey: string; verificationKey: Record<string, unknown> & { protocol: 'groth16'; curve: 'bn128'; nPublic: number } }
export async function loadArtifacts(directory: string): Promise<Artifacts> {
  const dir = resolve(directory);
  for (const [name, expected] of Object.entries(OFFICIAL_ARTIFACTS)) {
    if (createHash('sha256').update(await readFile(join(dir, name))).digest('hex') !== expected) throw new Error('ARTIFACT_INTEGRITY');
  }
  const verificationKey = JSON.parse(await readFile(join(dir, 'verification_key.json'), 'utf8')) as Artifacts['verificationKey'];
  if (verificationKey.protocol !== 'groth16' || verificationKey.curve !== 'bn128' || verificationKey.nPublic !== 9 ||
      !Array.isArray(verificationKey.IC) || verificationKey.IC.length !== 10) throw new Error('ARTIFACT_INTEGRITY');
  return Object.freeze({ wasm: join(dir, 'vfy-policy.wasm'), zkey: join(dir, 'vfy-policy_final.zkey'), verificationKey });
}
