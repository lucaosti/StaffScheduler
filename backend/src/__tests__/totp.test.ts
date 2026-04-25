/**
 * TOTP utility tests. Uses RFC 6238 official test vectors.
 */

import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateSecret,
  hotp,
  totp,
  verifyTotp,
} from '../utils/totp';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('encodes empty buffer to empty string', () => {
    expect(base32Encode(Buffer.alloc(0))).toBe('');
  });

  it('strips characters outside the base32 alphabet (lenient input)', () => {
    expect(base32Decode('!').length).toBe(0);
  });

  it('ignores spaces and case in decode', () => {
    const original = base32Encode(Buffer.from('hi'));
    const noisy = original.toLowerCase().split('').join(' ');
    expect(base32Decode(noisy).toString()).toBe('hi');
  });
});

describe('hotp / totp', () => {
  // RFC 4226 Appendix D test vectors. Secret "12345678901234567890" in ASCII.
  const SECRET = base32Encode(Buffer.from('12345678901234567890'));
  const RFC_VECTORS: Array<[number, string]> = [
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ];

  it.each(RFC_VECTORS)('hotp(secret, %i) == %s', (counter, expected) => {
    expect(hotp(SECRET, counter)).toBe(expected);
  });

  it('totp wraps hotp using floor(now/step) as the counter', () => {
    const code = totp(SECRET, { nowSeconds: 59, stepSeconds: 30 });
    expect(code).toBe(hotp(SECRET, 1));
  });

  it('verifyTotp accepts a code from the previous step within window', () => {
    // Code generated at t=59 belongs to counter=1; verifying at t=89 (counter=2)
    // is one step ahead, which fits the default ±1 window.
    const code = totp(SECRET, { nowSeconds: 59 });
    expect(verifyTotp(SECRET, code, { nowSeconds: 89 })).toBe(true);
  });

  it('verifyTotp rejects a code outside the window', () => {
    const code = totp(SECRET, { nowSeconds: 0 });
    expect(verifyTotp(SECRET, code, { nowSeconds: 600 })).toBe(false);
  });
});

describe('helpers', () => {
  it('generateSecret produces a 32-char base32 string for the default 20-byte length', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('buildOtpauthUri encodes issuer and account', () => {
    const uri = buildOtpauthUri({
      issuer: 'Staff Scheduler',
      account: 'jane@example.com',
      secretBase32: 'JBSWY3DPEHPK3PXP',
    });
    expect(uri).toContain('otpauth://totp/Staff%20Scheduler:jane%40example.com');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Staff+Scheduler');
  });

  it('generateRecoveryCodes returns the requested count of XXXXX-XXXXX codes', () => {
    const codes = generateRecoveryCodes(5);
    expect(codes).toHaveLength(5);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  });
});
