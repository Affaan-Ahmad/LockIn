import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { ConfigError, PersistenceError } from './errors';

/**
 * AES-256-GCM envelope for Google refresh/access tokens at rest.
 *
 * Why encrypt at all when the row already has deny-all RLS: the tokens grant
 * read access to a student's coursework independently of our database. A
 * backup, a logical replica, a support export or a leaked connection string
 * would otherwise hand over live Google credentials. RLS protects the API
 * surface; encryption protects the bytes.
 *
 * GCM (not CBC) so that tampering is detected rather than silently decrypted
 * into garbage. `aad` binds a ciphertext to its owner: a row copied from one
 * user to another fails authentication instead of decrypting.
 *
 * Format: [1 byte version][12 byte iv][16 byte tag][ciphertext]
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptSecret(plaintext: string, key: Buffer, aad: string): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(envelope: Buffer, key: Buffer, aad: string): string {
  assertKey(key);
  if (envelope.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new PersistenceError('Stored credential envelope is truncated', {
      context: { reason: 'TRUNCATED' },
    });
  }
  const version = envelope[0];
  if (version !== VERSION) {
    throw new PersistenceError(`Unsupported credential envelope version: ${String(version)}`, {
      context: { reason: 'UNSUPPORTED_VERSION', version: version ?? -1 },
    });
  }
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (cause) {
    // Authentication failure: wrong key, wrong owner, or tampered bytes. All
    // three mean "treat this credential as unusable", never "guess".
    //
    // The reason is carried in the context so a caller can tell this apart from
    // a column that was simply NULL. Conflating the two is what turns a wrong
    // GOOGLE_TOKEN_ENCRYPTION_KEY into a report of "Google never sent a refresh
    // token", which sends whoever is debugging to the consent screen instead of
    // to the deployment's environment.
    throw new PersistenceError('Stored credential failed authentication', {
      cause,
      context: { reason: 'AUTH_FAILED' },
    });
  }
}

export function decodeKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new ConfigError('GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/**
 * A short, non-reversible fingerprint of an encryption key.
 *
 * Exists to answer one question that has no safe answer otherwise: "is the key
 * in production the same one that wrote these rows?" Comparing the keys
 * themselves means printing them; comparing nothing means finding out from a
 * user whose credentials stopped decrypting.
 *
 * Thirty-two bits of a SHA-256 over a 256-bit key. Enough to tell two
 * deployments apart at a glance, far too little to attack -- and it is a hash of
 * the key, never any part of the key.
 */
export function keyFingerprint(key: Buffer): string {
  assertKey(key);
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new ConfigError('AES-256-GCM requires a 32-byte key');
  }
}
