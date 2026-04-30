/**
 * System info service.
 *
 * Reads chrome-level runtime metadata from the backend (currently the
 * `mode` flag used to render the demo banner).
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { requestJson } from './apiUtils';

export type RuntimeMode = 'production' | 'demo' | 'development';

export interface SystemInfo {
  mode: RuntimeMode;
}

export const getSystemInfo = async (): Promise<ApiResponse<SystemInfo>> => {
  return requestJson<SystemInfo>('/system/info', { method: 'GET' });
};
