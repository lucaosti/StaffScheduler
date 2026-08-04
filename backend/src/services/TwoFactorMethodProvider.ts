/**
 * The 2FA method-provider contract (#586, part of #331).
 *
 * `TwoFactorService` dispatches to one of these by `TwoFactorMethodType`
 * rather than owning TOTP-specific logic itself, so a new second-factor
 * method (WebAuthn #587, email code #588, SMS #589) is a new class
 * implementing this interface, registered in `TwoFactorService`'s provider
 * map — no change to the dispatcher, the routes, or the schema.
 *
 * Recovery codes are deliberately NOT part of this interface: they
 * authenticate "prove you're the account owner," not "prove you have this
 * specific method," so `TwoFactorService` owns them centrally, one set per
 * user regardless of how many methods are enrolled.
 *
 * @author Luca Ostinelli
 */

/** Every method type the registry can hold a row for. */
export type TwoFactorMethodType = 'totp' | 'webauthn' | 'email' | 'sms';

export interface TwoFactorSetupPayload {
  /** Provider-specific data the client needs to complete enrollment (e.g. a TOTP secret + otpauth URI). */
  [key: string]: unknown;
}

export interface TwoFactorMethodProvider {
  readonly type: TwoFactorMethodType;

  /**
   * Step 1 of enrollment: generate and persist provider-specific setup data,
   * but leave the method disabled until `confirmEnable` proves possession.
   */
  beginSetup(userId: number, accountLabel: string): Promise<TwoFactorSetupPayload>;

  /**
   * Step 2 of enrollment: verify a code/assertion against the pending setup
   * and, on success, mark the method enabled. Throws on failure (invalid
   * code, no pending setup, already enabled) — the caller renders the
   * message, it does not interpret a boolean.
   */
  confirmEnable(userId: number, code: string): Promise<void>;

  /** Verifies a login/step-up code against this method. Never throws — false on any failure. */
  verifyCode(userId: number, code: string): Promise<boolean>;

  /** Removes this method's enrollment entirely (disabled + secret data cleared). */
  disable(userId: number): Promise<void>;

  /** Whether this method is enrolled AND enabled for the user. */
  isEnabled(userId: number): Promise<boolean>;
}
