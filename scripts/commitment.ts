import { loadStrategyConfig } from '../src/commitment.js';

try {
  const config = loadStrategyConfig();
  if (config === undefined) throw new Error('commitment_unavailable');
  process.stdout.write(`${config.commitment}\n`);
} catch {
  process.stderr.write('commitment_unavailable\n');
  process.exitCode = 1;
}
