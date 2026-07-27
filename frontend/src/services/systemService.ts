/**
 * System info service.
 *
 * Reads chrome-level runtime metadata from the backend (currently the
 * `mode` flag used to render the demo banner).
 *
 * Routed through the generated client (`../api/client`) so the path and method
 * are checked against the OpenAPI contract at compile time rather than being a
 * template literal that only fails at runtime. See `departmentService` for the
 * full rationale behind the migration.
 *
 * `SystemInfo` stays hand-written: `/system/info` returns runtime chrome, not
 * a domain entity, so there is no shared schema to derive it from — unlike the
 * request bodies and query filters, which are taken from the contract.
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { apiClient } from '../api/client';

export type RuntimeMode = 'production' | 'demo' | 'development';

export interface SystemInfo {
  mode: RuntimeMode;
}

export const getSystemInfo = (): Promise<ApiResponse<SystemInfo>> =>
  apiClient.get<SystemInfo, '/system/info'>('/system/info');
