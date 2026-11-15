import { createHmac, timingSafeEqual } from 'node:crypto';

/** The wire format is plain hex, with no `sha256=` prefix. */
export function signBody(secret: string, raw: Buffer | string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

/** Reject ambiguous headers before comparing equal-length binary digests. */
export function verifySignature(
  secret: string,
  raw: Buffer | string,
  header: string | string[] | undefined,
): boolean {
  if (typeof header !== 'string' || !/^[0-9a-fA-F]{64}$/.test(header)) return false;
  const expected = Buffer.from(signBody(secret, raw), 'hex');
  return timingSafeEqual(expected, Buffer.from(header, 'hex'));
}
