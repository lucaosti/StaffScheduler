/**
 * Payroll export provider abstraction.
 *
 * One line item per employee for one pay period, and one method to send a
 * batch of them. Deliberately this small: the concrete vendors (Gusto, ADP,
 * Workday) each map this shape to their own API differently, and that
 * mapping is exactly what "design the provider abstraction first so new
 * providers are additive" means — a new vendor is a new class implementing
 * this interface, not a change to the export service, the job queue, or the
 * route that triggers a run.
 *
 * @author Luca Ostinelli
 */

export interface PayrollLineItem {
  userId: number;
  fullName: string;
  email: string;
  hours: number;
  grossPay: number;
}

export interface PayrollBatch {
  rangeStart: string;
  rangeEnd: string;
  lines: PayrollLineItem[];
}

export interface PayrollProvider {
  readonly name: string;
  /** Sends one pay-period batch. Returns the provider's own reference for it. */
  export(batch: PayrollBatch): Promise<{ providerReference: string }>;
}
