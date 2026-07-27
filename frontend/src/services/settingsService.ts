/**
 * System settings service.
 *
 * Wraps `GET /api/settings` and the `PUT /api/settings/*` endpoints. Requires
 * the `settings.manage` permission.
 *
 * Routed through the generated client so path, method and body are checked
 * against the OpenAPI contract at compile time; the request bodies are derived
 * from it rather than retyped, for the reasons set out in `employeeService`.
 *
 * `SystemSetting` stays hand-written: settings rows are key/value
 * configuration, not a domain entity in `packages/shared/src/domain.ts`, so
 * there is nothing to derive the response shape from. That gap is stated here
 * rather than papered over with a copy that looks authoritative.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import type { paths } from '../api/schema';
import { apiClient } from '../api/client';

interface SystemSetting {
  category: string;
  key: string;
  value: string;
  defaultValue?: string;
  description?: string;
  isSystem?: boolean;
}

type CurrencyBody = paths['/settings/currency']['put']['requestBody']['content']['application/json'];
type TimePeriodBody =
  paths['/settings/time-period']['put']['requestBody']['content']['application/json'];

/**
 * The accepted values, taken from the contract.
 *
 * Both mutators used to take a bare `string`, so `updateCurrency('GBP')`
 * compiled and failed at runtime with a 400 — the endpoints have always
 * validated against these enums. Publishing the narrow types moves that
 * rejection to compile time and gives callers something to validate against,
 * which `SystemSection` now does with the value it loads from the server.
 */
export type Currency = CurrencyBody['currency'];
export type TimePeriod = TimePeriodBody['timePeriod'];

// Module-private: the guards are the useful surface, and callers that need to
// render a picker declare their own labelled list typed against `Currency` /
// `TimePeriod`, so an option the endpoint would reject fails to compile there.
const CURRENCIES: readonly string[] = ['EUR', 'USD'] satisfies readonly Currency[];
const TIME_PERIODS: readonly string[] = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
] satisfies readonly TimePeriod[];

export const isCurrency = (value: string): value is Currency => CURRENCIES.includes(value);
export const isTimePeriod = (value: string): value is TimePeriod => TIME_PERIODS.includes(value);

export const getSystemSettings = (): Promise<ApiResponse<SystemSetting[]>> =>
  apiClient.get<SystemSetting[], '/settings'>('/settings');

export const updateCurrency = (currency: Currency): Promise<ApiResponse<{ currency: string }>> =>
  apiClient.put<{ currency: string }, '/settings/currency'>('/settings/currency', { currency });

export const updateTimePeriod = (
  timePeriod: TimePeriod
): Promise<ApiResponse<{ timePeriod: string }>> =>
  apiClient.put<{ timePeriod: string }, '/settings/time-period'>('/settings/time-period', {
    timePeriod,
  });
