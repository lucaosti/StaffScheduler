/**
 * Email transport (nodemailer).
 *
 * WHY THIS EXISTS / WHY IT'S GATED: `config.email` was fully specified but no
 * mailer was ever installed, so email notifications were dead configuration —
 * a silent no-op. This wraps a real nodemailer SMTP transport, but only when
 * email is actually configured (`isEmailConfigured()`): email notifications
 * enabled AND an SMTP host + credentials present. A deployment without SMTP
 * therefore sends nothing *and creates no email intent* (NotificationService
 * skips the outbox write), so there is no dead path either way — email is
 * either really delivered or explicitly off.
 *
 * The transport is created lazily and memoised, so importing this module costs
 * nothing until the first send, and unit tests can construct it without opening
 * a socket.
 *
 * @author Luca Ostinelli
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../config/logger';

let transporter: Transporter | null = null;

/**
 * True when email delivery is both enabled and has somewhere to send: an SMTP
 * host and credentials. This is the single gate NotificationService and the
 * outbox worker consult, so "is email on?" is decided in exactly one place.
 */
export function isEmailConfigured(): boolean {
  return Boolean(
    config.notifications.emailEnabled &&
      config.email.host &&
      config.email.auth.user &&
      config.email.auth.pass
  );
}

/** Lazily build (and memoise) the SMTP transport from config. */
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: { user: config.email.auth.user, pass: config.email.auth.pass },
    });
  }
  return transporter;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Send one email. Throws on failure so the caller (the outbox worker) can record
 * the error and retry — delivery is never silently dropped. Refuses to run when
 * email is not configured, which is a programming error (callers must gate on
 * isEmailConfigured first).
 */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error('sendEmail called while email is not configured');
  }
  const from = `${config.email.from.name} <${config.email.from.address}>`;
  await getTransporter().sendMail({
    from,
    to: email.to,
    subject: email.subject,
    text: email.text,
  });
  logger.info(`Email sent to ${email.to}: ${email.subject}`);
}

/** Test hook: reset the memoised transport (so a fresh config is picked up). */
export function resetTransporter(): void {
  transporter = null;
}
