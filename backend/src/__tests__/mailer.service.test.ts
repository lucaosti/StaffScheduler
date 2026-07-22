/**
 * MailerService tests — the email configuration gate and send path.
 */

export {};

const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({ createTransport }));

import { config } from '../config';
import { isEmailConfigured, sendEmail, resetTransporter } from '../services/MailerService';

const original = JSON.parse(JSON.stringify({
  emailEnabled: config.notifications.emailEnabled,
  email: config.email,
}));

const configureEmail = () => {
  config.notifications.emailEnabled = true;
  config.email.host = 'smtp.example.com';
  config.email.auth.user = 'user@example.com';
  config.email.auth.pass = 'secret';
};

beforeEach(() => {
  jest.clearAllMocks();
  resetTransporter();
  config.notifications.emailEnabled = original.emailEnabled;
  config.email.host = original.email.host;
  config.email.auth.user = original.email.auth.user;
  config.email.auth.pass = original.email.auth.pass;
});

describe('isEmailConfigured', () => {
  it('is false without credentials', () => {
    config.email.auth.user = undefined;
    config.email.auth.pass = undefined;
    expect(isEmailConfigured()).toBe(false);
  });

  it('is true when enabled with host + credentials', () => {
    configureEmail();
    expect(isEmailConfigured()).toBe(true);
  });

  it('is false when email notifications are disabled', () => {
    configureEmail();
    config.notifications.emailEnabled = false;
    expect(isEmailConfigured()).toBe(false);
  });
});

describe('sendEmail', () => {
  it('throws when email is not configured', async () => {
    config.email.auth.user = undefined;
    await expect(sendEmail({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow(/not configured/);
  });

  it('sends via the memoised transport when configured', async () => {
    configureEmail();
    await sendEmail({ to: 'a@b.c', subject: 'Hello', text: 'Body' });
    await sendEmail({ to: 'd@e.f', subject: 'Again', text: 'More' });
    expect(createTransport).toHaveBeenCalledTimes(1); // memoised
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'a@b.c', subject: 'Hello', text: 'Body' });
  });
});
