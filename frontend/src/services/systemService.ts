/**
 * System info service.
 *
 * Reads chrome-level runtime metadata from the backend (currently the
 * `mode` flag used to render the demo banner).
 *
 * @author Luca Ostinelli
 */

import { ApiResponse } from '../types';
import { getAuthHeaders, handleResponse } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export type RuntimeMode = 'production' | 'demo' | 'development';

export interface SystemInfo {
  mode: RuntimeMode;
}

export const getSystemInfo = async (): Promise<ApiResponse<SystemInfo>> => {
  const response = await fetch(`${API_BASE_URL}/system/info`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<SystemInfo>(response);
};
