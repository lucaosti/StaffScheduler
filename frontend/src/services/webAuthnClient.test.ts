/**
 * webAuthnClient — translates `@simplewebauthn/browser`'s ceremony failures
 * into messages a person can act on. The cases with weight are the ones that
 * have nothing to do with the server: the user cancelling the OS prompt, a
 * passkey already registered, and a browser with no WebAuthn support at all.
 *
 * @author Luca Ostinelli
 */

import { runWebAuthnRegistration, runWebAuthnAuthentication } from './webAuthnClient';

const mockStartRegistration = jest.fn();
const mockStartAuthentication = jest.fn();

jest.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args: unknown[]) => mockStartRegistration(...args),
  startAuthentication: (...args: unknown[]) => mockStartAuthentication(...args),
}));

const domException = (name: string, message = 'failed') => {
  const err = new Error(message);
  err.name = name;
  return err;
};

// jsdom does not implement PublicKeyCredential at all, so every test but the
// "unsupported browser" one below needs to fake its presence — otherwise
// every unrecognized error would read as "this browser doesn't support
// passkeys" regardless of what actually went wrong.
beforeEach(() => {
  (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential = function () {};
});

describe('runWebAuthnRegistration', () => {
  it('returns the ceremony response JSON-stringified', async () => {
    mockStartRegistration.mockResolvedValue({ id: 'cred-1' });
    const result = await runWebAuthnRegistration({} as never);
    expect(result).toBe(JSON.stringify({ id: 'cred-1' }));
    expect(mockStartRegistration).toHaveBeenCalledWith({ optionsJSON: {} });
  });

  it('translates a cancelled/timed-out prompt (NotAllowedError)', async () => {
    mockStartRegistration.mockRejectedValue(domException('NotAllowedError'));
    await expect(runWebAuthnRegistration({} as never)).rejects.toThrow(
      'Passkey request was cancelled or timed out.'
    );
  });

  it('translates an already-registered passkey (InvalidStateError)', async () => {
    mockStartRegistration.mockRejectedValue(domException('InvalidStateError'));
    await expect(runWebAuthnRegistration({} as never)).rejects.toThrow(
      'This passkey is already registered.'
    );
  });

  it('relays the original message for an unrecognized error', async () => {
    mockStartRegistration.mockRejectedValue(new Error('Something else went wrong'));
    await expect(runWebAuthnRegistration({} as never)).rejects.toThrow('Something else went wrong');
  });

  it('falls back to a generic message for a non-Error throw', async () => {
    mockStartRegistration.mockRejectedValue('a string, not an Error');
    await expect(runWebAuthnRegistration({} as never)).rejects.toThrow('Passkey request failed.');
  });

  it('reports missing browser support when PublicKeyCredential is absent', async () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    mockStartRegistration.mockRejectedValue(new Error('not supported'));

    await expect(runWebAuthnRegistration({} as never)).rejects.toThrow(
      'This browser does not support passkeys.'
    );
  });
});

describe('runWebAuthnAuthentication', () => {
  it('returns the ceremony response JSON-stringified', async () => {
    mockStartAuthentication.mockResolvedValue({ id: 'assertion-1' });
    const result = await runWebAuthnAuthentication({} as never);
    expect(result).toBe(JSON.stringify({ id: 'assertion-1' }));
    expect(mockStartAuthentication).toHaveBeenCalledWith({ optionsJSON: {} });
  });

  it('translates a cancelled/timed-out prompt (NotAllowedError)', async () => {
    mockStartAuthentication.mockRejectedValue(domException('NotAllowedError'));
    await expect(runWebAuthnAuthentication({} as never)).rejects.toThrow(
      'Passkey request was cancelled or timed out.'
    );
  });
});
