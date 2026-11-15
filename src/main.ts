import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { loadArtifacts } from './artifacts.js';
import { loadStrategyConfig } from './commitment.js';
import { ProcessProver } from './prover.js';
import { TurnStore } from './store.js';
import { KurierClient } from './zkverify.js';
import { createEngine } from './engine.js';
import { createServer } from './server.js';

export async function startService(config = loadConfig(), strategy = loadStrategyConfig()) {
  const artifacts = await loadArtifacts(config.artifactsDir);
  const finalizer = config.apiKey && config.vkHash ? new KurierClient({ network: config.network, apiKey: config.apiKey, vkHash: config.vkHash }) : undefined;
  const store = new TurnStore(config.dbPath); const shutdown = new AbortController();
  const engine = createEngine({ store, prover: new ProcessProver(artifacts), ...(strategy ? { strategy } : {}),
    ...(finalizer ? { finalizer } : {}), shutdownSignal: shutdown.signal, maxInFlight: config.maxInFlight, proofTimeoutMs: config.proofTimeoutMs });
  const server = createServer({ secret: config.secret, agentPath: config.agentPath, bodyLimit: config.bodyLimit,
    responseBudgetMs: config.responseBudgetMs, maxTaskAgeMs: config.maxTaskAgeMs, clockSkewMs: config.clockSkewMs,
    handler: engine.handle, onOutcome: engine.onOutcome, ready: engine.ready });
  server.addHook('onClose', async () => { shutdown.abort(); store.close(); });
  try { await server.listen({ host: config.host, port: config.port }); }
  catch { await server.close(); throw new Error('STARTUP_FAILED'); }
  return { server, stop: async () => { shutdown.abort(); await server.close(); }, ready: engine.ready };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const service = await startService();
    process.stdout.write(JSON.stringify({ event: 'service_started', competitionReady: service.ready() }) + '\n');
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; try { await service.stop(); } catch { process.exitCode = 1; } };
    process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
  } catch { process.stderr.write('service_startup_failed\n'); process.exitCode = 1; }
}
