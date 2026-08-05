/**
 * SMS transport abstraction.
 *
 * WHY THIS EXISTS / WHY IT'S GATED: the SMS 2FA method type already exists
 * end-to-end (registry table, provider interface, routes, schemas), but no
 * SMS vendor is implemented or configured. Rather than leaving the
 * `sms` method type unreachable, this file defines the shape a real vendor
 * integration plugs into: a `SmsProvider` interface with one method,
 * `send(toNumber, body)`. No concrete implementation ships in this PR — that
 * is the entire point of the abstraction: choosing a vendor (Twilio, Vonage,
 * ...) is a separate decision involving an external paid account, and this
 * module must not force that decision or hold credentials for it.
 *
 * `isSmsConfigured()` mirrors `MailerService.isEmailConfigured()`'s shape
 * exactly, so the two gates read the same way at every call site. It always
 * evaluates to false in this PR: `config.sms` exists as a home for a future
 * vendor's config (mirroring `config.email`), but no vendor's credential
 * fields are defined yet, so there is nothing valid to gate on. Wiring in a
 * real vendor later means: add its config fields under `config.sms`, swap
 * the `false` below for a `Boolean(...)` check over them (the same shape as
 * `isEmailConfigured()`), implement `SmsProvider`, and construct it into
 * `SmsCodeProvider` — no other file changes.
 *
 * @author Luca Ostinelli
 */

import { config } from '../config';

/**
 * True when SMS delivery is both enabled and has somewhere to send. Always
 * false today — see the module comment above. Referencing `config.sms` here
 * (even though it is currently unused by the check) keeps the shape ready:
 * once a vendor is chosen, this becomes
 * `Boolean(config.notifications.smsEnabled && config.sms.provider && <vendor credentials>)`,
 * the same pattern `isEmailConfigured()` uses.
 */
export function isSmsConfigured(): boolean {
  void config.sms.provider;
  return false;
}

/**
 * The contract a concrete SMS vendor integration implements. Kept to a
 * single method so any vendor's SDK can be wrapped in a few lines, and so
 * tests can supply a trivial mock without pulling in an HTTP client.
 *
 * `SmsCodeProvider` takes an optional `SmsProvider` via constructor
 * injection (undefined today, since none is implemented) rather than this
 * module constructing one itself — the same reason `TwoFactorService`
 * constructs each `TwoFactorMethodProvider` rather than each provider
 * reaching for a singleton: the caller decides what's wired in, so tests and
 * future vendor swaps never touch `SmsCodeProvider`'s internals.
 */
export interface SmsProvider {
  /** Sends `body` to `toNumber`. Throws on delivery failure — never silently drops a message. */
  send(toNumber: string, body: string): Promise<void>;
}
