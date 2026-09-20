/**
 * Password hashing utility for the Authentication_Service (Requirement 1).
 *
 * Uses Node's built-in `node:crypto` scrypt key-derivation function so no
 * additional npm dependency is required. A stored credential is a single,
 * self-describing string of the form:
 *
 *   scrypt$<saltHex>$<hashHex>
 *
 * where `saltHex` is a random 16-byte salt and `hashHex` is the 64-byte derived
 * key, both hex-encoded. Verification is constant-time (`timingSafeEqual`) so a
 * mismatch does not leak timing information, and any malformed stored value is
 * treated as a non-match rather than throwing.
 *
 * These functions are the concrete `comparePassword`/hashing implementation the
 * pure `verifyCredentials` domain function (src/domain/auth.ts) defers to; they
 * hold the only knowledge of the on-disk hash format.
 *
 * _Requirements: 1.3, 1.4_
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Algorithm tag stored as the first segment of every credential string. */
const ALGORITHM = 'scrypt';
/** Salt length in bytes. */
const SALT_BYTES = 16;
/** Derived-key (hash) length in bytes. */
const KEY_BYTES = 64;

/**
 * Hash a plaintext password into a self-describing `scrypt$<salt>$<hash>`
 * string. A fresh random salt is generated per call, so hashing the same
 * password twice yields different stored values.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plain, salt, KEY_BYTES);
  return `${ALGORITHM}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored `scrypt$<salt>$<hash>` value.
 *
 * Returns `false` for any malformed stored value (wrong algorithm tag, missing
 * segments, non-hex/odd-length data, or a hash of unexpected length) rather
 * than throwing, so a corrupt record can never crash a sign-in. The comparison
 * of the derived keys is constant-time.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3) {
    return false;
  }

  const [algorithm, saltHex, hashHex] = parts;
  if (algorithm !== ALGORITHM || !saltHex || !hashHex) {
    return false;
  }

  const salt = hexToBuffer(saltHex);
  const expected = hexToBuffer(hashHex);
  if (salt === null || expected === null || expected.length !== KEY_BYTES) {
    return false;
  }

  const derived = scryptSync(plain, salt, expected.length);
  // Lengths are guaranteed equal here, so timingSafeEqual is safe to call.
  return timingSafeEqual(derived, expected);
}

/**
 * Decode a hex string to a Buffer, returning `null` when the input is not a
 * valid, even-length hexadecimal string. `Buffer.from(str, 'hex')` silently
 * truncates malformed input, so the round-trip is validated explicitly.
 */
function hexToBuffer(hex: string): Buffer | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  return Buffer.from(hex, 'hex');
}
