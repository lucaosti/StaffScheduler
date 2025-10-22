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

// @ts-ignore
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export interface ScheduleData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'published' | 'archived' | 'generated';
  departmentId?: string;
  departmentName?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

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
    const response = await fetch(`${API_BASE_URL}/api/schedules?${query}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const getScheduleById = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const getScheduleWithShifts = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}/shifts`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
    const response = await fetch(`${API_BASE_URL}/api/schedules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const updateSchedule = async (id: string, params: Partial<CreateScheduleParams>) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const deleteSchedule = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const generateSchedule = async (id: string): Promise<{ success: boolean; data?: GenerateScheduleResponse; error?: any }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const publishSchedule = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}/publish`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const archiveSchedule = async (id: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}/archive`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
export const duplicateSchedule = async (id: string, params: CreateScheduleParams) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/schedules/${id}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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
    const response = await fetch(`${API_BASE_URL}/api/schedules/department/${departmentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
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

export default {
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
