/**
 * Two-factor enrolment — per-method rows (#594, part of #331): an
 * authenticator app (TOTP), a passkey (WebAuthn), and an emailed code.
 *
 * The assertion carrying the most weight is that the recovery codes cannot be
 * dismissed by accident. They are produced once by `enable` and are not
 * fetchable afterwards, so a panel someone can navigate past without noticing
 * is how an account is lost the first time a phone is replaced.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import TwoFactorSection from './TwoFactorSection';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const refreshUser = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ refreshUser }),
}));

const listTwoFactorMethods = jest.fn();
const beginTwoFactorSetup = jest.fn();
const enableTwoFactor = jest.fn();
const disableTwoFactor = jest.fn();
const requestTwoFactorChallenge = jest.fn();

jest.mock('../../services/twoFactorService', () => ({
  __esModule: true,
  listTwoFactorMethods: (...a: unknown[]) => listTwoFactorMethods(...a),
  beginTwoFactorSetup: (...a: unknown[]) => beginTwoFactorSetup(...a),
  enableTwoFactor: (...a: unknown[]) => enableTwoFactor(...a),
  disableTwoFactor: (...a: unknown[]) => disableTwoFactor(...a),
  requestTwoFactorChallenge: (...a: unknown[]) => requestTwoFactorChallenge(...a),
}));

const runWebAuthnRegistration = jest.fn();
const runWebAuthnAuthentication = jest.fn();
jest.mock('../../services/webAuthnClient', () => ({
  runWebAuthnRegistration: (...a: unknown[]) => runWebAuthnRegistration(...a),
  runWebAuthnAuthentication: (...a: unknown[]) => runWebAuthnAuthentication(...a),
}));

/** Finds the card for one method by its heading text, so multi-row queries don't collide. */
const methodCard = (label: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name: label });
  return heading.closest('div.border') as HTMLElement;
};

beforeEach(() => {
  refreshUser.mockReset().mockResolvedValue(undefined);
  listTwoFactorMethods.mockReset().mockImplementation(() => okResponse({ methods: [] }));
  beginTwoFactorSetup
    .mockReset()
    .mockImplementation(() =>
      okResponse({ secret: 'S3CR3T', otpauthUri: 'otpauth://totp/demo?secret=S3CR3T' })
    );
  enableTwoFactor
    .mockReset()
    .mockImplementation(() => okResponse({ recoveryCodes: ['aaa-111', 'bbb-222'] }));
  disableTwoFactor.mockReset().mockImplementation(() => okResponse(undefined));
  requestTwoFactorChallenge.mockReset().mockImplementation(() => okResponse(null));
  runWebAuthnRegistration.mockReset().mockResolvedValue('{"id":"cred-1"}');
  runWebAuthnAuthentication.mockReset().mockResolvedValue('{"id":"assertion-1"}');
});

describe('when no method is enabled', () => {
  it('lists all three methods as not enabled, each offering setup', async () => {
    render(<TwoFactorSection />);
    expect(await screen.findAllByText('Not enabled')).toHaveLength(3);
    expect(within(methodCard('Authenticator app')).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(within(methodCard('Passkey')).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(within(methodCard('Email code')).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });
});

describe('TOTP enrolment', () => {
  it('shows the secret and the otpauth URI after starting', async () => {
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Set up' }));

    expect(await screen.findByText(/otpauth:\/\/totp/)).toBeInTheDocument();
    expect(screen.getByText(/^Secret: S3CR3T$/)).toBeInTheDocument();
  });

  it('enables with a code and reloads methods + the user', async () => {
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Code from your app'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(enableTwoFactor).toHaveBeenCalledWith('123456', 'totp'));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(listTwoFactorMethods).toHaveBeenCalledTimes(2); // once on mount, once after enabling
  });

  it('relays a rejected code', async () => {
    enableTwoFactor.mockImplementation(() =>
      Promise.reject(new Error('Invalid two-factor authentication code'))
    );
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Code from your app'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid two-factor/);
  });
});

describe('email enrolment', () => {
  it('sends a code and enables once it is entered', async () => {
    beginTwoFactorSetup.mockImplementation(() => okResponse({}));
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Email code')).getByRole('button', { name: 'Set up' }));

    expect(beginTwoFactorSetup).toHaveBeenCalledWith('email');
    await userEvent.type(await screen.findByLabelText('Code from your email'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(enableTwoFactor).toHaveBeenCalledWith('654321', 'email'));
  });
});

describe('WebAuthn enrolment', () => {
  it('runs the browser ceremony and enables with its response', async () => {
    beginTwoFactorSetup.mockImplementation(() => okResponse({ challenge: 'reg-challenge' }));
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Passkey')).getByRole('button', { name: 'Set up' }));

    expect(beginTwoFactorSetup).toHaveBeenCalledWith('webauthn');
    const continueButton = await screen.findByRole('button', { name: /continue with passkey/i });
    await userEvent.click(continueButton);

    await waitFor(() => expect(runWebAuthnRegistration).toHaveBeenCalledWith({ challenge: 'reg-challenge' }));
    await waitFor(() => expect(enableTwoFactor).toHaveBeenCalledWith('{"id":"cred-1"}', 'webauthn'));
  });

  it('relays a cancelled/failed ceremony', async () => {
    beginTwoFactorSetup.mockImplementation(() => okResponse({ challenge: 'reg-challenge' }));
    runWebAuthnRegistration.mockRejectedValue(new Error('Passkey request was cancelled or timed out.'));
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Passkey')).getByRole('button', { name: 'Set up' }));
    await userEvent.click(await screen.findByRole('button', { name: /continue with passkey/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled or timed out/i);
    expect(enableTwoFactor).not.toHaveBeenCalled();
  });
});

describe('the recovery codes', () => {
  const enable = async () => {
    render(<TwoFactorSection />);
    await screen.findAllByText('Not enabled');
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Code from your app'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await screen.findByText('aaa-111');
  };

  it('are shown once, with what they are for', async () => {
    await enable();
    expect(screen.getByText('bbb-222')).toBeInTheDocument();
    expect(screen.getByText(/cannot be retrieved later/i)).toBeInTheDocument();
  });

  it('need an explicit acknowledgement before the panel closes', async () => {
    await enable();
    expect(screen.getByRole('button', { name: 'I have saved them' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByText('aaa-111')).not.toBeInTheDocument();
  });

  it('are not shown again when a second method is enabled', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['totp'] }));
    enableTwoFactor.mockImplementation(() => okResponse({ recoveryCodes: [] }));
    render(<TwoFactorSection />);
    await screen.findByText('Enabled');
    await userEvent.click(within(methodCard('Email code')).getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Code from your email'), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(enableTwoFactor).toHaveBeenCalledWith('654321', 'email'));
    expect(screen.queryByText(/save these recovery codes/i)).not.toBeInTheDocument();
  });
});

describe('when a method is enabled', () => {
  it('says so and asks for proof before turning it off', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['totp'] }));
    render(<TwoFactorSection />);

    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Turn off' }));
    expect(
      screen.getByLabelText('Code from this method, or a recovery code')
    ).toBeInTheDocument();
    expect(within(methodCard('Authenticator app')).queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument();
  });

  it('turns off with a code', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['totp'] }));
    render(<TwoFactorSection />);
    await screen.findByText('Enabled');
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Turn off' }));
    await userEvent.type(
      screen.getByLabelText('Code from this method, or a recovery code'),
      '654321'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm turn off' }));

    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith('654321', 'totp'));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('relays a refusal and stays enabled', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['totp'] }));
    disableTwoFactor.mockImplementation(() =>
      Promise.reject(new Error('Invalid two-factor authentication code'))
    );
    render(<TwoFactorSection />);
    await screen.findByText('Enabled');
    await userEvent.click(within(methodCard('Authenticator app')).getByRole('button', { name: 'Turn off' }));
    await userEvent.type(
      screen.getByLabelText('Code from this method, or a recovery code'),
      '000000'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm turn off' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid two-factor/);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('sends a fresh code before turning off email', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['email'] }));
    render(<TwoFactorSection />);
    await screen.findByText('Enabled');
    await userEvent.click(within(methodCard('Email code')).getByRole('button', { name: 'Turn off' }));
    await userEvent.click(screen.getByRole('button', { name: /send code to my email/i }));

    expect(requestTwoFactorChallenge).toHaveBeenCalledWith('email');
    await userEvent.type(
      await screen.findByLabelText('Code from this method, or a recovery code'),
      '111222'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm turn off' }));

    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith('111222', 'email'));
  });

  it('turns off WebAuthn by running the assertion ceremony', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['webauthn'] }));
    requestTwoFactorChallenge.mockImplementation(() => okResponse({ challenge: 'auth-challenge' }));
    render(<TwoFactorSection />);
    await screen.findByText('Enabled');
    await userEvent.click(within(methodCard('Passkey')).getByRole('button', { name: 'Turn off' }));
    await userEvent.click(screen.getByRole('button', { name: /continue with passkey to turn off/i }));

    await waitFor(() => expect(requestTwoFactorChallenge).toHaveBeenCalledWith('webauthn'));
    await waitFor(() => expect(runWebAuthnAuthentication).toHaveBeenCalled());
    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith('{"id":"assertion-1"}', 'webauthn'));
  });

  it('lets a WebAuthn user fall back to a recovery code', async () => {
    listTwoFactorMethods.mockImplementation(() => okResponse({ methods: ['webauthn'] }));
    render(<TwoFactorSection />);
    await screen.findByText('Enabled');
    await userEvent.click(within(methodCard('Passkey')).getByRole('button', { name: 'Turn off' }));
    await userEvent.click(screen.getByRole('button', { name: /use a recovery code instead/i }));

    await userEvent.type(
      screen.getByLabelText('Code from this method, or a recovery code'),
      'RECOVERY-1'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm turn off' }));

    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith('RECOVERY-1', 'webauthn'));
    expect(requestTwoFactorChallenge).not.toHaveBeenCalled();
  });
});
