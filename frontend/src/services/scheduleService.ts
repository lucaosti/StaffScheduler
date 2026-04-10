/**
 * Schedule Service
 * 
 * API client for schedule management operations including:
 * - CRUD operations for schedules
 * - Schedule generation and optimization
 * - Schedule publishing and archiving
 * 
 * @author Luca Ostinelli
 */

import { getAuthHeaders } from './apiUtils';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface CreateScheduleParams {
  name: string;
  startDate: string;
  endDate: string;
  departmentId: string;
}

export interface GenerateScheduleResponse {
  scheduleId: string;
  totalAssignments: number;
  coverage: string;
  fairnessScore: string;
  message: string;
}

/**
 * Get all schedules
 */
export const getSchedules = async (params?: Record<string, any>) => {
  try {
    const query = new URLSearchParams(params || {});
    const response = await fetch(`${API_BASE_URL}/schedules?${query}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schedules: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
      data: [],
    };
  }
};

/**
 * Get schedule by ID
 */
export const getScheduleById = async (id: string | number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Get schedule with all shifts
 */
export const getScheduleWithShifts = async (id: string | number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}/shifts`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schedule with shifts: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching schedule with shifts:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Create new schedule
 */
export const createSchedule = async (params: CreateScheduleParams) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to create schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Update schedule
 */
export const updateSchedule = async (id: string | number, params: Partial<CreateScheduleParams>) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to update schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Delete schedule
 */
export const deleteSchedule = async (id: string | number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Generate optimized schedule
 */
export const generateSchedule = async (id: string | number): Promise<{ success: boolean; data?: GenerateScheduleResponse; error?: any }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error generating schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Publish schedule
 */
export const publishSchedule = async (id: string | number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}/publish`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to publish schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error publishing schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Archive schedule
 */
export const archiveSchedule = async (id: string | number) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}/archive`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to archive schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error archiving schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Duplicate schedule
 */
export const duplicateSchedule = async (id: string | number, params: CreateScheduleParams) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/${id}/duplicate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Failed to duplicate schedule: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error duplicating schedule:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
};

/**
 * Get schedules by department
 */
export const getSchedulesByDepartment = async (departmentId: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedules/department/${departmentId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schedules: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : 'Unknown error' },
      data: [],
    };
  }
};

const scheduleService = {
  getSchedules,
  getScheduleById,
  getScheduleWithShifts,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  generateSchedule,
  publishSchedule,
  archiveSchedule,
  duplicateSchedule,
  getSchedulesByDepartment,
};

export default scheduleService;
