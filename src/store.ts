import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, constants } from 'node:fs';
import { dirname } from 'node:path';

export type Reservation = { kind: 'fresh'; lease: string; idempotencyKey: string } |
  { kind: 'cached'; body: string; idempotencyKey: string } | { kind: 'processing' | 'conflict' | 'reused' };
export class TurnStore {
  private readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
    }
    this.db = new Database(path, { timeout: 500 });
    this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS turns (
      match_id TEXT NOT NULL, turn INTEGER NOT NULL, body_hash TEXT NOT NULL,
      nonce TEXT NOT NULL UNIQUE, lease TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','completed')),
      body TEXT, PRIMARY KEY(match_id,turn)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS matches (match_id TEXT PRIMARY KEY NOT NULL, commitment TEXT NOT NULL) STRICT`);
  }
  bindMatch(matchId: string, commitment: string): boolean {
    if (!/^0x[0-9a-fA-F]{64}$/.test(commitment)) throw new Error('INVALID_COMMITMENT');
    return this.db.transaction(() => {
      const old = this.db.prepare('SELECT commitment FROM matches WHERE match_id=?').get(matchId) as { commitment: string } | undefined;
      if (old) return old.commitment === commitment.toLowerCase();
      this.db.prepare('INSERT INTO matches(match_id,commitment) VALUES(?,?)').run(matchId, commitment.toLowerCase());
      return true;
    }).immediate();
  }
  reserve(matchId: string, turn: number, bodyHash: string, nonce: string): Reservation {
    return this.db.transaction((): Reservation => {
      const existing = this.db.prepare('SELECT body_hash,status,body,idempotency_key FROM turns WHERE match_id=? AND turn=?').get(matchId, turn) as
        { body_hash: string; status: string; body: string | null; idempotency_key: string } | undefined;
      if (existing) {
        if (existing.body_hash !== bodyHash) return { kind: 'conflict' };
        if (existing.status === 'completed' && existing.body !== null) return { kind: 'cached', body: existing.body, idempotencyKey: existing.idempotency_key };
        return { kind: 'processing' };
      }
      if (this.db.prepare('SELECT 1 FROM turns WHERE nonce=?').get(nonce)) return { kind: 'reused' };
      const lease = randomBytes(32).toString('hex'); const idempotencyKey = randomUUID();
      this.db.prepare('INSERT INTO turns(match_id,turn,body_hash,nonce,lease,idempotency_key) VALUES(?,?,?,?,?,?)')
        .run(matchId, turn, bodyHash, nonce, lease, idempotencyKey);
      return { kind: 'fresh', lease, idempotencyKey };
    }).immediate();
  }
  complete(matchId: string, turn: number, bodyHash: string, lease: string, body: string): void {
    const result = this.db.prepare("UPDATE turns SET status='completed',body=? WHERE match_id=? AND turn=? AND body_hash=? AND lease=? AND status='processing'")
      .run(body, matchId, turn, bodyHash, lease);
    if (result.changes !== 1) throw new Error('STALE_LEASE');
  }
  close(): void { this.db.close(); }
}
