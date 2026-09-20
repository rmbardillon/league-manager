import { describe, it, expect } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

/**
 * Password hashing utility unit tests.
 *
 * Verify the scrypt round-trip: a hash of a password verifies against that
 * password, a wrong password does not, distinct hashes are produced per call
 * (random salt), and malformed stored values are rejected without throwing.
 */
describe('password hashing', () => {
  it('round-trips: verifyPassword is true for the hashed password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('s3cret-Pa$$word');
    expect(verifyPassword('not-the-password', stored)).toBe(false);
  });

  it('produces the documented scrypt$<salt>$<hash> format', () => {
    const stored = hashPassword('anything');
    const parts = stored.split('$');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scrypt');
    // 16-byte salt and 64-byte key, hex-encoded (2 hex chars per byte).
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/);
  });

  it('uses a fresh salt so the same password hashes differently each time', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    // ...yet both still verify against the original password.
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });

  it('returns false (no throw) for malformed stored values', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$deadbeef')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$abcd$abcd')).toBe(false);
    // Non-hex salt/hash segments.
    expect(verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
    // Well-formed hex but wrong hash length.
    expect(verifyPassword('x', 'scrypt$abcd$abcd')).toBe(false);
  });
});
