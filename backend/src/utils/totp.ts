/**
 * Minimal RFC 6238 TOTP / RFC 4226 HOTP implementation backed by node:crypto.
 *
 * Pure functions only — no DB or env reads. All values are deterministic
 * given the inputs, which makes them trivially testable.
 *
 * @author Luca Ostinelli
 */

import { createHmac, randomBytes } from 'crypto';

/** Base32 alphabet from RFC 4648, no padding. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encodes a Buffer as base32 (no padding). */
export const base32Encode = (buf: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
};

/** Decodes a base32 string (case-insensitive, ignores spaces/padding) into a Buffer. */
export const base32Decode = (input: string): Buffer => {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/** Generates a random base32 secret. Default 20 bytes, RFC 6238 recommendation. */
export const generateSecret = (lengthBytes = 20): string =>
  base32Encode(randomBytes(lengthBytes));

const intToBuffer = (value: number): Buffer => {
  const buf = Buffer.alloc(8);
  // Node's writeBigUInt64BE requires bigint; counters fit comfortably in 53 bits.
  buf.writeBigUInt64BE(BigInt(value));
  return buf;
};

/** RFC 4226 HOTP. Pure function. */
export const hotp = (secretBase32: string, counter: number, digits = 6): string => {
  const key = base32Decode(secretBase32);
  const digest = createHmac('sha1', key).update(intToBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = (bin % 10 ** digits).toString().padStart(digits, '0');
  return otp;
};

/** RFC 6238 TOTP. `nowSeconds` is injectable for testability. */
export const totp = (
  secretBase32: string,
  options: { stepSeconds?: number; digits?: number; nowSeconds?: number } = {}
): string => {
  const step = options.stepSeconds ?? 30;
  const digits = options.digits ?? 6;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  return hotp(secretBase32, Math.floor(now / step), digits);
};

/**
 * Verifies a candidate code against the current TOTP, allowing a configurable
 * window of clock skew (default ±1 step). Constant-time comparison for the
 * actual digit match.
 */
export const verifyTotp = (
  secretBase32: string,
  code: string,
  options: { window?: number; stepSeconds?: number; digits?: number; nowSeconds?: number } = {}
): boolean => {
  const window = options.window ?? 1;
  const step = options.stepSeconds ?? 30;
  const digits = options.digits ?? 6;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / step);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secretBase32, counter + i, digits);
    if (constantTimeEqual(expected, code)) return true;
  }
  return false;
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
};

/** Builds the standard otpauth:// URI consumed by Google Authenticator etc. */
export const buildOtpauthUri = (params: {
  issuer: string;
  account: string;
  secretBase32: string;
  digits?: number;
  period?: number;
  algorithm?: 'SHA1' | 'SHA256';
}): string => {
  const issuer = encodeURIComponent(params.issuer);
  const account = encodeURIComponent(params.account);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: params.algorithm ?? 'SHA1',
    digits: String(params.digits ?? 6),
    period: String(params.period ?? 30),
  });
  return `otpauth://totp/${issuer}:${account}?${query.toString()}`;
};

/** Generates N 10-character base32 recovery codes, dash-separated for readability. */
export const generateRecoveryCodes = (count = 10): string[] => {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = base32Encode(randomBytes(6));
    codes.push(`${chunk.slice(0, 5)}-${chunk.slice(5, 10)}`);
  }
  return codes;
};
