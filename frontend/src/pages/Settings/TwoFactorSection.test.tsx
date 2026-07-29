/**
 * Two-factor enrolment.
 *
 * The assertion carrying the most weight is that the recovery codes cannot be
 * dismissed by accident. They are produced once by `enable` and are not
 * fetchable afterwards, so a panel someone can navigate past without noticing
 * is how an account is lost the first time a phone is replaced.
 *
 * @author Luca Ostinelli
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test-utils/renderWithClient';
import TwoFactorSection from './TwoFactorSection';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

let twoFactorEnabled = false;
const refreshUser = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 5, twoFactorEnabled }, refreshUser }),
}));

const beginTwoFactorSetup = jest.fn();
const enableTwoFactor = jest.fn();
const disableTwoFactor = jest.fn();

jest.mock('../../services/twoFactorService', () => ({
  __esModule: true,
  beginTwoFactorSetup: (...a: unknown[]) => beginTwoFactorSetup(...a),
  enableTwoFactor: (...a: unknown[]) => enableTwoFactor(...a),
  disableTwoFactor: (...a: unknown[]) => disableTwoFactor(...a),
}));

beforeEach(() => {
  twoFactorEnabled = false;
  refreshUser.mockReset().mockResolvedValue(undefined);
  beginTwoFactorSetup
    .mockReset()
    .mockImplementation(() =>
      okResponse({ secret: 'S3CR3T', otpauthUri: 'otpauth://totp/demo?secret=S3CR3T' })
    );
  enableTwoFactor
    .mockReset()
    .mockImplementation(() => okResponse({ recoveryCodes: ['aaa-111', 'bbb-222'] }));
  disableTwoFactor.mockReset().mockImplementation(() => okResponse(undefined));
});

describe('when 2FA is off', () => {
  it('says so and offers setup', () => {
    render(<TwoFactorSection />);
    expect(screen.getByText('Not enabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
  });

  it('shows the secret and the otpauth URI after starting', async () => {
    render(<TwoFactorSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));

    // The URI is what a QR code encodes, and every authenticator accepts it
    // pasted — which also covers enrolling on the device you are reading on.
    expect(await screen.findByText(/otpauth:\/\/totp/)).toBeInTheDocument();
    // The secret appears inside the URI too, so match the labelled line.
    expect(screen.getByText(/^Secret: S3CR3T$/)).toBeInTheDocument();
  });

  it('says the account is not protected until the code is entered', async () => {
    render(<TwoFactorSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    // Setup stores a secret and leaves 2FA off; a UI implying otherwise would
    // have people believe they are protected when they are not.
    expect(await screen.findByText(/not protected until you do/i)).toBeInTheDocument();
  });

  it('enables with a code and re-reads the user', async () => {
    render(<TwoFactorSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Code from your app'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(enableTwoFactor).toHaveBeenCalledWith('123456'));
    // The flag lives on the user; without re-reading it the page would keep
    // offering "Set up" to someone who had just finished setting it up.
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('relays a rejected code', async () => {
    enableTwoFactor.mockImplementation(() =>
      Promise.reject(new Error('Invalid two-factor authentication code'))
    );
    render(<TwoFactorSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await userEvent.type(await screen.findByLabelText('Code from your app'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid two-factor/);
  });
});

describe('the recovery codes', () => {
  const enable = async () => {
    render(<TwoFactorSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Set up' }));
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
    // A panel someone can navigate past without noticing is how an account is
    // lost the first time a phone is replaced.
    expect(screen.getByRole('button', { name: 'I have saved them' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByText('aaa-111')).not.toBeInTheDocument();
  });
});

describe('when 2FA is on', () => {
  it('says so and asks for proof before turning it off', async () => {
    twoFactorEnabled = true;
    render(<TwoFactorSection />);

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    // Turning it off weakens the account as much as signing in does, so it
    // takes the same proof of possession — and a recovery code counts.
    expect(
      screen.getByLabelText('Code from your app, or a recovery code')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument();
  });

  it('turns off with a code', async () => {
    twoFactorEnabled = true;
    render(<TwoFactorSection />);
    await userEvent.type(
      screen.getByLabelText('Code from your app, or a recovery code'),
      '654321'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith('654321'));
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
  });

  it('relays a refusal and stays enabled', async () => {
    twoFactorEnabled = true;
    disableTwoFactor.mockImplementation(() =>
      Promise.reject(new Error('Invalid two-factor authentication code'))
    );
    render(<TwoFactorSection />);
    await userEvent.type(
      screen.getByLabelText('Code from your app, or a recovery code'),
      '000000'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid two-factor/);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });
});
