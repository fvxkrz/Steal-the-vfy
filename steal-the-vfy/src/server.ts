import { isUtf8 } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { signBody, verifySignature } from './auth.js';
import { parseEnvelope, parseTurnResponse, safeHold, type Turn, type TurnResponse } from './protocol.js';

export interface ServerOptions {
  secret: string;
  agentPath?: string;
  bodyLimit?: number;
  handler: (turn: Turn, raw: Buffer, signal: AbortSignal) => Promise<TurnResponse | string>;
  onOutcome?: (turn: Turn, raw: Buffer, signal: AbortSignal, wireBody: string) => void | Promise<void>;
  now?: () => number;
  maxTaskAgeMs?: number;
  clockSkewMs?: number;
  responseBudgetMs?: number;
  ready?: () => boolean;
}

const SIGNATURE = 'x-agent-games-signature';
interface RequestState {
  receivedWall: number;
  receivedMono: number;
  deadlineWall: number;
  deadlineMono: number;
  controller: AbortController;
  timeout: Promise<string>;
  expire: () => void;
  timer: NodeJS.Timeout;
  turn?: Turn;
  raw?: Buffer;
  wireBody?: string;
  fallbackBody?: string;
}

export function createServer(options: ServerOptions): FastifyInstance {
  const now = options.now ?? Date.now;
  const maxTaskAgeMs = options.maxTaskAgeMs ?? 300_000;
  const clockSkewMs = options.clockSkewMs ?? 5_000;
  const responseBudgetMs = options.responseBudgetMs ?? 25_000;
  if (!Number.isFinite(responseBudgetMs) || responseBudgetMs <= 0 || responseBudgetMs >= 30_000) {
    throw new RangeError('responseBudgetMs must be positive and below 30 seconds');
  }
  if (!Number.isFinite(maxTaskAgeMs) || maxTaskAgeMs <= 0 || !Number.isFinite(clockSkewMs) || clockSkewMs < 0) {
    throw new RangeError('invalid timestamp policy');
  }
  const app = Fastify({
    logger: false, logController: new LogController({ disableRequestLogging: true }), trustProxy: false,
    bodyLimit: options.bodyLimit ?? 64 * 1024,
    clientErrorHandler: (_error, socket) => {
      if (!socket.writable) return;
      const raw = JSON.stringify({ error: 'INVALID_REQUEST' });
      socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(raw)}\r\n${SIGNATURE}: ${signBody(options.secret, raw)}\r\nConnection: close\r\n\r\n${raw}`);
    },
    frameworkErrors: (_error, request, reply) => {
      const raw = request.method === 'HEAD' ? '' : JSON.stringify({ error: 'INVALID_REQUEST' });
      (reply as FastifyReply).code(400).type('application/json').header(SIGNATURE, signBody(options.secret, raw)).send(raw);
    },
  });
  app.server.headersTimeout = 10_000;
  app.server.maxHeadersCount = 100;
  const states = new WeakMap<FastifyRequest, RequestState>();
  const active = new Set<() => void>();
  app.addHook('preClose', async () => { for (const expire of active) expire(); active.clear(); });
  const fallback = (state: RequestState): string => state.fallbackBody ??= JSON.stringify(state.turn ? safeHold(state.turn) : { error: 'TIMEOUT' });
  const expired = (state: RequestState) => {
    const wall = now();
    return state.controller.signal.aborted || !Number.isFinite(wall)
      || performance.now() >= state.deadlineMono || wall >= state.deadlineWall;
  };

  // Receipt time includes raw upload, authentication, parsing and serialization.
  app.addHook('onRequest', async (request, reply) => {
    const receivedMono = performance.now();
    const receivedWall = now();
    const controller = new AbortController();
    let resolveTimeout!: (wire: string) => void;
    const timeout = new Promise<string>(resolve => { resolveTimeout = resolve; });
    const expire = () => {
      const state = states.get(request)!;
      const wire = fallback(state);
      resolveTimeout(wire);
      controller.abort();
      clearTimeout(state.timer);
      active.delete(expire);
      if (!reply.sent && !reply.raw.destroyed) reply.code(state.turn ? 200 : 504).type('application/json').send(wire);
    };
    const timer = setTimeout(expire, responseBudgetMs);
    states.set(request, { receivedWall, receivedMono, deadlineWall: receivedWall + responseBudgetMs,
      deadlineMono: receivedMono + responseBudgetMs, controller, timeout, expire, timer });
    active.add(expire);
    request.raw.once('aborted', expire);
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) expire(); });
  });
  app.addHook('onResponse', async request => {
    const state = states.get(request);
    clearTimeout(state?.timer);
    if (state) active.delete(state.expire);
    if (state?.turn && state.raw && state.wireBody !== undefined) {
      try { await options.onOutcome?.(state.turn, state.raw, state.controller.signal, state.wireBody); }
      catch { /* A finalized wire response cannot be rewritten on recording failure. */ }
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const state = states.get(request);
    let raw = payload as string | Buffer;
    // Timers cannot run during synchronous work. This runs AFTER serialization.
    if (state && reply.statusCode === 200 && expired(state)) {
      state.controller.abort();
      raw = fallback(state);
      reply.removeHeader('content-length');
    }
    if (request.method === 'HEAD') raw = '';
    reply.type('application/json').header(SIGNATURE, signBody(options.secret, raw));
    if (state) state.wireBody = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    return raw;
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode === 413 ? 413 : 500;
    return reply.code(status).send({ error: status === 413 ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_request, reply) => {
    const ready = options.ready?.() ?? true;
    return reply.code(ready ? 200 : 503).send({ ok: ready });
  });
  app.post(options.agentPath ?? '/agent', async (request, reply) => {
    const state = states.get(request)!;
    if (reply.sent) return reply;
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!verifySignature(options.secret, raw, request.headers[SIGNATURE])) {
      return reply.code(401).send({ error: 'BAD_SIGNATURE' });
    }
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
      || request.headers['content-encoding'] !== undefined) {
      return reply.code(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    let envelope: ReturnType<typeof parseEnvelope>;
    try {
      if (!isUtf8(raw)) throw new Error('invalid UTF-8');
      envelope = parseEnvelope(JSON.parse(raw.toString('utf8')));
    }
    catch { return reply.code(400).send({ error: 'INVALID_ENVELOPE' }); }
    const current = now();
    const issued = Date.parse('type' in envelope ? envelope.issued_at : envelope.issuedAt);
    if (!Number.isFinite(current) || issued > current + clockSkewMs || current - issued > maxTaskAgeMs) {
      return reply.code(400).send({ error: 'INVALID_ENVELOPE' });
    }
    if ('type' in envelope) return reply.send({ ok: true, protocolVersion: 'v1' });
    const deadline = Date.parse(envelope.deadlineAt);
    state.turn = envelope;
    state.raw = raw;
    state.deadlineWall = Math.min(state.deadlineWall, deadline);
    state.deadlineMono = Math.min(state.deadlineMono,
      state.receivedMono + deadline - state.receivedWall, performance.now() + deadline - current);
    clearTimeout(state.timer);
    state.timer = setTimeout(state.expire, Math.max(0, state.deadlineMono - performance.now()));
    if (expired(state)) { state.expire(); return reply; }
    try {
      const result = await Promise.race([options.handler(envelope, raw, state.controller.signal), state.timeout]);
      if (reply.sent || reply.raw.destroyed) return reply;
      const wire = typeof result === 'string' ? result : JSON.stringify(parseTurnResponse(result));
      // Re-validate serialized bytes: toJSON must not change the action or schema.
      const response = parseTurnResponse(JSON.parse(wire));
      if (response.matchId !== envelope.matchId || response.turn !== envelope.turn) throw new Error('mismatched response');
      return reply.type('application/json').send(wire);
    } catch {
      return reply.sent ? reply : reply.type('application/json').send(fallback(state));
    }
  });
  return app;
}
