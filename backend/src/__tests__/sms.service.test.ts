/**
 * SmsService tests — the always-off SMS configuration gate.
 */

export {};

import { config } from '../config';
import { isSmsConfigured } from '../services/SmsService';

describe('isSmsConfigured', () => {
  it('is always false — no SMS vendor is implemented yet', () => {
    expect(isSmsConfigured()).toBe(false);
  });

  it('stays false even if a provider name is present in config', () => {
    const original = config.sms.provider;
    config.sms.provider = 'some-vendor';
    expect(isSmsConfigured()).toBe(false);
    config.sms.provider = original;
  });
});
