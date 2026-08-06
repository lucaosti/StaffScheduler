/**
 * Gusto payroll provider.
 *
 * First concrete implementation of `PayrollProvider`, chosen over ADP/Workday
 * because its REST API is reachable with a developer sandbox account rather
 * than an enterprise partner agreement — see the issue this closes for the
 * comparison. No production credentials ship with this repository; every
 * export attempt checks `isGustoConfigured()` first and fails loudly rather
 * than silently, the same posture `EmailCodeProvider`/`SmsCodeProvider` take
 * for their own "nothing to send with yet" case.
 *
 * The exact request/response shape below targets Gusto's documented
 * Bearer-token REST conventions (JSON body, `company_id` in the path) as of
 * this writing; an operator wiring in real credentials should verify the
 * current endpoint and payload against Gusto's own API reference before
 * relying on this in production — API surfaces evolve, and this repository
 * has no live account to integration-test against continuously.
 *
 * @author Luca Ostinelli
 */

import { config } from '../config';
import type { PayrollBatch, PayrollProvider } from './PayrollProvider';

const REQUEST_TIMEOUT_MS = 15_000;

export function isGustoConfigured(): boolean {
  return Boolean(config.gusto.apiKey && config.gusto.companyId);
}

export class GustoProvider implements PayrollProvider {
  readonly name = 'gusto';

  async export(batch: PayrollBatch): Promise<{ providerReference: string }> {
    if (!isGustoConfigured()) {
      throw new Error('Gusto is not configured — set GUSTO_API_KEY and GUSTO_COMPANY_ID');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${config.gusto.apiBaseUrl}/v1/companies/${config.gusto.companyId}/payroll_imports`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.gusto.apiKey}`,
          },
          body: JSON.stringify({
            pay_period: { start_date: batch.rangeStart, end_date: batch.rangeEnd },
            // Matched by email rather than a stored Gusto employee id: there
            // is no id-mapping table yet, and email is the one identifier
            // both systems already agree on.
            employee_compensations: batch.lines.map((line) => ({
              employee_email: line.email,
              hours: line.hours,
              gross_pay_cents: Math.round(line.grossPay * 100),
            })),
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Gusto responded ${response.status}${body ? `: ${body}` : ''}`);
      }

      const result = (await response.json().catch(() => ({}))) as { id?: string | number };
      if (result.id === undefined) {
        throw new Error('Gusto response did not include an import id');
      }
      return { providerReference: String(result.id) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
