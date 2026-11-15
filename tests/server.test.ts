import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import { parseEnvelope, safeHold, type Turn, type TurnResponse } from '../src/protocol.js';
import { createServer } from '../src/server.js';
import { publicInputsHash } from '../src/public-hash.js';

const secret = randomBytes(32).toString('hex');
const signatureHeader = 'x-agent-games-signature';
const digest = (raw: string | Buffer) => createHmac('sha256', secret).update(raw).digest('hex');
function turnAt(now = Date.now(), deadlineMs = 300_000): Turn {
  const parsed = parseEnvelope({
    protocolVersion: 'v1', eventId: 'steal-the-vfy', mode: 'practice',
    matchId: '9f4e1b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b', turn: 3,
    issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + deadlineMs).toISOString(),
    state: { selfBalance: '95', opponentBalance: '105', selfFortifiedUntilTurn: null, opponentFortifiedUntilTurn: null },
    strategyCommitment: { hash: `0x${'ab'.repeat(32)}` }, resolverVersion: 'v1', nonce: 'nonce-3',
  });
  if ('type' in parsed) throw new Error('not a turn');
  return parsed;
}
function signed(response: LightMyRequestResponse, status: number) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.headers[signatureHeader], digest(response.rawPayload));
  return response.body ? response.json() as Record<string, unknown> : {};
}
function post(value: unknown) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  return { method: 'POST' as const, url: '/agent', payload, headers: { 'content-type': 'application/json', [signatureHeader]: digest(payload) } };
}

test('all application, parser, router and HEAD responses sign their actual wire bytes', async () => {
  const app = createServer({ secret, bodyLimit: 128, ready: () => false, handler: async turn => safeHold(turn) });
  app.get('/throws', async () => { throw new Error(`private-${secret}`); });
  try {
    assert.deepEqual(signed(await app.inject('/readyz'), 503), { ok: false });
    assert.deepEqual(signed(await app.inject('/missing'), 404), { error: 'NOT_FOUND' });
    assert.deepEqual(signed(await app.inject('/throws'), 500), { error: 'INTERNAL_ERROR' });
    signed(await app.inject(post('x'.repeat(256))), 413);
    signed(await app.inject({ method: 'HEAD', url: '/healthz' }), 200);
    signed(await app.inject('/bad/%ZZ'), 400);
    assert.equal(app.server.maxHeadersCount, 100);
    assert.equal(app.server.headersTimeout, 10_000);
  } finally { await app.close(); }
});

test('authenticates exact raw bytes before parsing malformed or modified JSON', async () => {
  let calls = 0;
  const app = createServer({ secret, handler: async turn => { calls++; return safeHold(turn); } });
  try {
    const invalid = { ...post('{not-json'), headers: { 'content-type': 'application/json', [signatureHeader]: '0'.repeat(64) } };
    assert.deepEqual(signed(await app.inject(invalid), 401), { error: 'BAD_SIGNATURE' });
    assert.deepEqual(signed(await app.inject(post('{not-json')), 400), { error: 'INVALID_ENVELOPE' });
    const exact = post(turnAt());
    exact.payload += ' ';
    assert.deepEqual(signed(await app.inject(exact), 401), { error: 'BAD_SIGNATURE' });
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('unsupported transport encodings are rejected only after raw authentication', async () => {
  let calls = 0;
  const app = createServer({ secret, handler: async turn => { calls++; return safeHold(turn); } });
  try {
    for (const extra of [{ 'content-type': 'text/plain' }, { 'content-encoding': 'gzip' }]) {
      const request = post(turnAt());
      const headers = { ...request.headers, ...extra };
      assert.deepEqual(signed(await app.inject({ ...request, headers }), 415), { error: 'UNSUPPORTED_MEDIA_TYPE' });
      assert.deepEqual(signed(await app.inject({ ...request, headers: { ...headers, [signatureHeader]: '0'.repeat(64) } }), 401), { error: 'BAD_SIGNATURE' });
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('signed unknown fields never echo an unchecked match or call the turn handler', async () => {
  let calls = 0;
  const app = createServer({ secret, handler: async turn => { calls++; return safeHold(turn); } });
  try {
    for (const bad of [{ ...turnAt(), extra: 1 }, { ...turnAt(), matchId: '9f4e1b2a-...' }, { ...turnAt(), state: { ...turnAt().state, amount: 5 } }]) {
      assert.deepEqual(signed(await app.inject(post(bad)), 400), { error: 'INVALID_ENVELOPE' });
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('timestamp policy permits five-minute turns but rejects stale, future and oversized windows', async () => {
  const now = Date.now();
  let calls = 0;
  const app = createServer({ secret, now: () => now, handler: async turn => { calls++; return safeHold(turn); } });
  try {
    signed(await app.inject(post(turnAt(now - 120_000))), 200);
    for (const bad of [turnAt(now + 5_001), turnAt(now - 300_001), { ...turnAt(now), deadlineAt: new Date(now + 300_001).toISOString() }, { ...turnAt(now), deadlineAt: new Date(now - 1).toISOString() }]) {
      assert.deepEqual(signed(await app.inject(post(bad)), 400), { error: 'INVALID_ENVELOPE' });
    }
    const preflight = { type: 'agent-games.preflight.v1', agent_id: 'agt', issued_at: new Date(now - 300_001).toISOString(), nonce: 'n' };
    assert.deepEqual(signed(await app.inject(post(preflight)), 400), { error: 'INVALID_ENVELOPE' });
    assert.equal(calls, 1);
  } finally { await app.close(); }
});

test('handler uncertainty or mismatched response identity yields echoed HOLD without fabricated evidence', async () => {
  const turn = turnAt();
  for (const handler of [
    async () => { throw new Error(secret); },
    async () => ({ ...safeHold(turn), matchId: '1f4e1b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b', action: { type: 'EXTRACT' as const, amount: 10 } }),
    async () => ({ ...safeHold(turn), turn: 4, action: { type: 'EXTRACT' as const, amount: 10 } }),
    async () => '{"action":{"type":"EXTRACT","amount":10}}',
  ]) {
    const app = createServer({ secret, handler });
    try {
      const value = signed(await app.inject(post(turn)), 200);
      assert.equal(value.matchId, turn.matchId);
      assert.equal(value.turn, turn.turn);
      assert.deepEqual(value.action, { type: 'HOLD' });
      assert.deepEqual(value.policyProof, { circuitVersion: 'v1', publicInputsHash: publicInputsHash(turn, { type: 'HOLD' }) });
      assert.equal(value.proof, undefined);
      assert.equal(value.public_signals, undefined);
    } finally { await app.close(); }
  }
});

test('signed deadline is an absolute cutoff with no clock-skew grace for action', async () => {
  let calls = 0;
  const now = Date.now();
  const turn = turnAt(now - 20_000, 19_999);
  const app = createServer({ secret, now: () => now, handler: async value => { calls++; return { ...safeHold(value), action: { type: 'EXTRACT', amount: 5 } }; } });
  try {
    assert.deepEqual(signed(await app.inject(post(turn)), 200).action, { type: 'HOLD' });
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

async function bounded<T>(work: Promise<T>, ms = 1_500): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('test watchdog')), ms); })]); }
  finally { clearTimeout(timer); }
}
function stall(ms: number) { const end = performance.now() + ms; while (performance.now() < end) { /* deliberately block timers */ } }

test('non-cooperative handler is bounded and original request signal reaches finalized outcome', async () => {
  let signal: AbortSignal | undefined;
  let outcomeSignal: AbortSignal | undefined;
  let cached: string | undefined;
  const app = createServer({ secret, responseBudgetMs: 20, handler: async (_turn, _raw, value) => {
    signal = value; return new Promise<TurnResponse>(() => {});
  }, onOutcome: (_turn, _raw, value, wire) => { outcomeSignal = value; cached = wire; } });
  try {
    const response = await bounded(app.inject(post(turnAt())));
    assert.deepEqual(signed(response, 200).action, { type: 'HOLD' });
    assert.equal(signal?.aborted, true);
    assert.equal(outcomeSignal, signal);
    assert.equal(cached, response.body);
  } finally { await app.close(); }
});

test('budget begins before a delayed upload and unknown body gets signed timeout without fake identity', async () => {
  let calls = 0;
  const app = createServer({ secret, responseBudgetMs: 25, handler: async turn => { calls++; return { ...safeHold(turn), action: { type: 'EXTRACT', amount: 5 } }; } });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const raw = JSON.stringify(turnAt());
  let req: http.ClientRequest | undefined;
  let uploadTimer: NodeJS.Timeout | undefined;
  try {
    const response = await bounded(new Promise<{ body: string; signature: string | string[] | undefined }>((resolve, reject) => {
      req = http.request(`${address}/agent`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw), [signatureHeader]: digest(raw) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString(), signature: res.headers[signatureHeader] }));
      });
      req.on('error', reject);
      req.write(raw.slice(0, 1));
      uploadTimer = setTimeout(() => req?.end(raw.slice(1)), 100);
    }));
    assert.equal(response.signature, digest(response.body));
    assert.deepEqual(JSON.parse(response.body), { error: 'TIMEOUT' });
    assert.equal(calls, 0);
  } finally { clearTimeout(uploadTimer); req?.destroy(); app.server.closeAllConnections(); await app.close(); }
});

test('blocked event loop cannot release extraction at the deadline and cancellation is observable', async () => {
  let signal: AbortSignal | undefined;
  const app = createServer({ secret, responseBudgetMs: 20, handler: async (turn, _raw, value) => {
    signal = value; stall(35); return { ...safeHold(turn), action: { type: 'EXTRACT', amount: 5 } };
  } });
  try {
    assert.deepEqual(signed(await bounded(app.inject(post(turnAt()))), 200).action, { type: 'HOLD' });
    assert.equal(signal?.aborted, true);
  } finally { await app.close(); }
});

test('cached raw replies retain exact bytes and onOutcome sees only the final signed serialization', async () => {
  let serializations = 0;
  let cached: string | undefined;
  const turn = turnAt();
  const exact = `${JSON.stringify(safeHold(turn), null, 2)}\n`;
  let useExact = true;
  const app = createServer({ secret, handler: async value => useExact ? exact : {
    ...safeHold(value), proof: { toJSON: () => ({ sequence: ++serializations }) },
  }, onOutcome: (_turn, _raw, _signal, wire) => { cached = wire; } });
  try {
    const first = await app.inject(post(turn));
    signed(first, 200);
    assert.equal(first.body, exact);
    assert.equal(cached, first.body);
    useExact = false;
    const second = await app.inject(post(turn));
    signed(second, 200);
    assert.equal(cached, second.body);
    assert.equal(serializations, 1);
  } finally { await app.close(); }
});

test('real HTTP parser failures and duplicate signature headers fail closed with signed bytes', async () => {
  let calls = 0;
  const app = createServer({ secret, handler: async turn => { calls++; return safeHold(turn); } });
  const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
  const send = async (request: string) => {
    let socket: net.Socket | undefined;
    try {
      return await bounded(new Promise<string>((resolve, reject) => {
        socket = net.createConnection({ host: address.hostname, port: Number(address.port) });
        const chunks: Buffer[] = [];
        socket.on('error', reject);
        socket.on('data', chunk => chunks.push(chunk));
        socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
        socket.on('connect', () => socket?.write(request));
      }));
    } finally { socket?.destroy(); }
  };
  try {
    const parser = await send('INVALID METHOD / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    const [headers, body = ''] = parser.split('\r\n\r\n');
    assert.match(headers ?? '', /^HTTP\/1.1 400 /);
    assert.ok(headers?.toLowerCase().includes(`${signatureHeader}: ${digest(body)}`), parser);
    assert.deepEqual(JSON.parse(body), { error: 'INVALID_REQUEST' });
    const raw = JSON.stringify(turnAt());
    const duplicate = await send(`POST /agent HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(raw)}\r\n${signatureHeader}: ${digest(raw)}\r\n${signatureHeader}: ${digest(raw)}\r\nConnection: close\r\n\r\n${raw}`);
    assert.match(duplicate, /^HTTP\/1.1 401 /);
    assert.ok(duplicate.toLowerCase().includes(`${signatureHeader}: ${digest('{"error":"BAD_SIGNATURE"}')}`));
    assert.equal(calls, 0);
  } finally { app.server.closeAllConnections(); await app.close(); }
});

test('client disconnect aborts original handler work before the response budget', async () => {
  let signal: AbortSignal | undefined;
  let started!: () => void;
  let canceled!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const cancel = new Promise<void>(resolve => { canceled = resolve; });
  const app = createServer({ secret, responseBudgetMs: 500, handler: async (_turn, _raw, value) => {
    signal = value; value.addEventListener('abort', canceled, { once: true }); started();
    return new Promise<TurnResponse>(() => {});
  } });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const request = post(turnAt());
  const req = http.request(`${address}/agent`, { method: 'POST', headers: request.headers });
  req.on('error', () => {});
  try {
    req.end(request.payload);
    await bounded(start);
    req.destroy();
    await bounded(cancel, 100);
    assert.equal(signal?.aborted, true);
  } finally { req.destroy(); app.server.closeAllConnections(); await app.close(); }
});

test('invalid timing options cannot disable the bounded push budget', async () => {
  const handler = async (turn: Turn) => safeHold(turn);
  for (const responseBudgetMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 30_000]) {
    assert.throws(() => createServer({ secret, handler, responseBudgetMs }), RangeError);
  }
  for (const patch of [{ maxTaskAgeMs: Number.NaN }, { maxTaskAgeMs: -1 }, { clockSkewMs: -1 }, { clockSkewMs: Number.POSITIVE_INFINITY }]) {
    assert.throws(() => createServer({ secret, handler, ...patch }), RangeError);
  }
  const app = createServer({ secret, handler, responseBudgetMs: 29_999, clockSkewMs: 0 });
  await app.close();
});

test('post-serialization wall-clock uncertainty chooses HOLD and records only the final wire body', async () => {
  for (const clock of ['forward', 'unknown', 'serialize'] as const) {
    const initial = Date.now();
    let wall = initial;
    let outcome: { wire: string; signal: AbortSignal } | undefined;
    let signal: AbortSignal | undefined;
    let finished = () => false;
    const app = createServer({ secret, now: () => wall, responseBudgetMs: 25, handler: async (turn, _raw, original) => {
      signal = original;
      if (clock === 'forward') wall += 100_000;
      if (clock === 'unknown') wall = Number.NaN;
      return { ...safeHold(turn), action: { type: 'EXTRACT', amount: 5 }, proof: { toJSON: () => { if (clock === 'serialize') stall(35); return { pi_a: ['1', '2'] }; } } };
    }, onOutcome: (_turn, _raw, original, wire) => { assert.equal(finished(), true); outcome = { wire, signal: original }; } });
    app.addHook('onRequest', async (_request, reply) => { finished = () => reply.raw.writableFinished; });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const req = post(turnAt(initial));
      const response = await bounded(fetch(`${address}/agent`, { method: 'POST', headers: req.headers, body: req.payload }));
      const wire = await response.text();
      assert.equal(response.headers.get(signatureHeader), digest(wire));
      assert.deepEqual(JSON.parse(wire).action, { type: 'HOLD' });
      assert.equal(JSON.parse(wire).proof, undefined);
      assert.equal(outcome?.wire, wire);
      assert.equal(outcome?.signal, signal);
      assert.equal(signal?.aborted, true);
    } finally { app.server.closeAllConnections(); await app.close(); }
  }
});

test('server shutdown cancels in-flight work using the same signal and signed HOLD', async () => {
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const app = createServer({ secret, responseBudgetMs: 500, handler: async (_turn, _raw, original) => {
    signal = original; started(); return new Promise<TurnResponse>(() => {});
  } });
  const pending = app.inject(post(turnAt()));
  try {
    await bounded(start);
    await bounded(app.close(), 100);
    assert.equal(signal?.aborted, true);
    assert.deepEqual(signed(await pending, 200).action, { type: 'HOLD' });
  } finally { await app.close(); await pending; }
});

test('authenticated malformed UTF-8 cannot be normalized into an accepted JSON envelope', async () => {
  let calls = 0;
  const app = createServer({ secret, handler: async turn => { calls++; return safeHold(turn); } });
  const raw = Buffer.from(JSON.stringify(turnAt()));
  raw[raw.indexOf('nonce-3')] = 0xff;
  try {
    const headers = { 'content-type': 'application/json', [signatureHeader]: digest(raw) };
    assert.deepEqual(signed(await app.inject({ method: 'POST', url: '/agent', headers, payload: raw }), 400), { error: 'INVALID_ENVELOPE' });
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('late handler completion cannot overwrite the finalized timeout body used for retry', async () => {
  let finalWire: string | undefined;
  let resolveLate!: (value: TurnResponse) => void;
  let submissions = 0;
  let originalSignal: AbortSignal | undefined;
  let completionSignal: AbortSignal | undefined;
  const turn = turnAt();
  const app = createServer({ secret, responseBudgetMs: 20, handler: async (_turn, _raw, signal) => {
    if (finalWire !== undefined) return finalWire;
    submissions++;
    originalSignal = signal;
    return new Promise<TurnResponse>(resolve => { resolveLate = resolve; });
  }, onOutcome: (_turn, _raw, signal, wire) => { if (finalWire === undefined) completionSignal = signal; finalWire = wire; } });
  try {
    const first = await bounded(app.inject(post(turn)));
    assert.deepEqual(signed(first, 200).action, { type: 'HOLD' });
    assert.equal(finalWire, first.body);
    assert.equal(completionSignal, originalSignal);
    resolveLate({ ...safeHold(turn), action: { type: 'EXTRACT', amount: 10 } });
    await new Promise<void>(resolve => setImmediate(resolve));
    const retry = await bounded(app.inject(post(turn)));
    signed(retry, 200);
    assert.equal(retry.body, first.body);
    assert.equal(finalWire, first.body);
    assert.equal(submissions, 1);
  } finally { await app.close(); }
});

test('common preflight and health use the exact documented signed wrappers', async () => {
  const app = createServer({ secret, handler: async turn => safeHold(turn) });
  try {
    const preflight = { type: 'agent-games.preflight.v1', agent_id: 'agt_abc', issued_at: new Date().toISOString(), nonce: 'n' };
    assert.deepEqual(signed(await app.inject(post(preflight)), 200), { ok: true, protocolVersion: 'v1' });
    assert.deepEqual(signed(await app.inject('/healthz'), 200), { ok: true });
    assert.deepEqual(signed(await app.inject('/readyz'), 200), { ok: true });
  } finally { await app.close(); }
});
