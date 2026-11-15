import { loadArtifacts } from '../src/artifacts.js';
try {
  if (process.argv[2] !== 'verify') throw new Error('UNSUPPORTED_OPERATION');
  await loadArtifacts(process.env.ARTIFACTS_DIR || './circuits');
  process.stdout.write(JSON.stringify({ event: 'vfy_artifacts_verified', protocol: 'groth16', curve: 'bn128', publicSignals: 9 }) + '\n');
} catch { process.stderr.write('artifact_operation_failed\n'); process.exitCode = 1; }
