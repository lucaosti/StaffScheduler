# 📚 Staff Scheduler - API Documentation

> **Complete REST API Reference for Staff Scheduler Backend**

Version: 1.0.0  
Base URL: `http://localhost:3001/api`  
Authentication: JWT Bearer Token

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Users](#users)
3. [Employees](#employees)
4. [Departments](#departments)
5. [Shifts](#shifts)
6. [Schedules](#schedules)
7. [Assignments](#assignments)
8. [Dashboard](#dashboard)
9. [System Settings](#system-settings)
10. [Error Handling](#error-handling)
11. [Response Format](#response-format)

---

## 🔐 Authentication

All API endpoints (except login and registration) require authentication via JWT token.

### Authentication Header

```http
Authorization: Bearer <your-jwt-token>
```

### POST /api/auth/login

Authenticate a user and receive a JWT token.

**Request Body:**

```json
{
  "email": "admin@staffscheduler.com",
  "password": "admin123"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "admin@staffscheduler.com",
      "firstName": "Admin",
      "lastName": "User",
      "role": "admin",
      "employeeId": "EMP001",
      "isActive": true
    }
  }
}
```

**Error Responses:**

- `400 Bad Request` - Missing email or password
- `401 Unauthorized` - Invalid credentials
- `403 Forbidden` - Account inactive

### POST /api/auth/logout

Logout the current user (invalidate token).

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET /api/auth/me

Get current authenticated user information.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@staffscheduler.com",
    "firstName": "Admin",
    "lastName": "User",
    "role": "admin",
    "employeeId": "EMP001",
    "departments": [
      {
        "departmentId": 1,
        "departmentName": "IT Department",
        "isManager": true
      }
    ]
  }
}
```

---

## 👥 Users

Manage system users with role-based permissions.

### GET /api/users

Get all users (with role-based filtering).

**Query Parameters:**

- `search` (string, optional) - Search by name, email, or employee ID
- `department` (number, optional) - Filter by department ID
- `role` (string, optional) - Filter by role (`admin`, `manager`, `department_manager`, `employee`)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "email": "admin@staffscheduler.com",
      "firstName": "Admin",
      "lastName": "User",
      "role": "admin",
      "employeeId": "EMP001",
      "phone": "+1234567890",
      "isActive": true,
      "lastLogin": "2025-10-29T10:30:00Z",
      "createdAt": "2025-01-01T00:00:00Z",
      "departments": [
        {
          "departmentId": 1,
          "departmentName": "IT Department",
          "isManager": true
        }
      ]
    }
  ]
}
```

### GET /api/users/:id

Get a specific user by ID.

**URL Parameters:**

- `id` (number) - User ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@staffscheduler.com",
    "firstName": "Admin",
    "lastName": "User",
    "role": "admin",
    "employeeId": "EMP001",
    "phone": "+1234567890",
    "isActive": true,
    "departments": [...]
  }
}
```

**Error Responses:**

- `404 Not Found` - User not found

### POST /api/users

Create a new user.

**Required Roles:** `admin`, `manager`, `department_manager`

**Request Body:**

```json
{
  "email": "newuser@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "role": "employee",
  "employeeId": "EMP123",
  "phone": "+1234567890",
  "departmentIds": [1, 2]
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "email": "newuser@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "employee",
    "employeeId": "EMP123"
  }
}
```

**Error Responses:**

- `400 Bad Request` - Missing required fields or validation errors
- `403 Forbidden` - Insufficient permissions
- `409 Conflict` - Email or employee ID already exists

### PUT /api/users/:id

Update an existing user.

**Required Roles:** `admin`, `manager` (or own profile)

**URL Parameters:**

- `id` (number) - User ID

**Request Body:**

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phone": "+0987654321",
  "isActive": true,
  "departmentIds": [1, 3]
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "email": "newuser@example.com",
    "firstName": "John",
    "lastName": "Smith",
    "phone": "+0987654321"
  },
  "message": "User updated successfully"
}
```

### DELETE /api/users/:id

Delete a user (soft delete - sets isActive to false).

**Required Roles:** `admin`

**URL Parameters:**

- `id` (number) - User ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

---

## 👨‍💼 Employees

Manage employee profiles and information.

### GET /api/employees

Get all employees.

**Query Parameters:**

- `department` (number, optional) - Filter by department ID
- `status` (string, optional) - Filter by status (`active`, `inactive`)
- `search` (string, optional) - Search by name or employee ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "userId": 2,
      "departmentId": 1,
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "employeeId": "EMP001",
      "hireDate": "2023-01-15",
      "contractType": "full_time",
      "maxHoursPerWeek": 40,
      "minHoursPerWeek": 20,
      "salary": 50000,
      "position": "Senior Developer",
      "isActive": true,
      "skills": [
        {
          "skillId": 1,
          "skillName": "JavaScript",
          "proficiencyLevel": 5
        }
      ]
    }
  ]
}
```

### GET /api/employees/:id

Get a specific employee by ID.

**URL Parameters:**

- `id` (number) - Employee ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 2,
    "departmentId": 1,
    "firstName": "John",
    "lastName": "Doe",
    "employeeId": "EMP001",
    "hireDate": "2023-01-15",
    "contractType": "full_time",
    "maxHoursPerWeek": 40,
    "minHoursPerWeek": 20,
    "department": {
      "id": 1,
      "name": "Engineering"
    },
    "skills": [...],
    "availability": {
      "monday": true,
      "tuesday": true,
      "wednesday": true,
      "thursday": true,
      "friday": true,
      "saturday": false,
      "sunday": false
    }
  }
}
```

### POST /api/employees

Create a new employee.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "userId": 5,
  "departmentId": 1,
  "hireDate": "2025-10-29",
  "contractType": "full_time",
  "maxHoursPerWeek": 40,
  "minHoursPerWeek": 20,
  "salary": 55000,
  "position": "Developer",
  "skills": [
    {
      "skillId": 1,
      "proficiencyLevel": 4
    }
  ]
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 10,
    "userId": 5,
    "departmentId": 1,
    "hireDate": "2025-10-29",
    "contractType": "full_time"
  },
  "message": "Employee created successfully"
}
```

### PUT /api/employees/:id

Update an existing employee.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Employee ID

**Request Body:**

```json
{
  "departmentId": 2,
  "maxHoursPerWeek": 35,
  "position": "Senior Developer",
  "salary": 60000
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 10,
    "departmentId": 2,
    "maxHoursPerWeek": 35,
    "position": "Senior Developer"
  },
  "message": "Employee updated successfully"
}
```

### DELETE /api/employees/:id

Delete an employee.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Employee ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Employee deleted successfully"
}
```

### GET /api/employees/:id/availability

Get employee availability for scheduling.

**URL Parameters:**

- `id` (number) - Employee ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "employeeId": 1,
    "weeklyAvailability": {
      "monday": { "available": true, "startTime": "09:00", "endTime": "17:00" },
      "tuesday": { "available": true, "startTime": "09:00", "endTime": "17:00" },
      "wednesday": { "available": true, "startTime": "09:00", "endTime": "17:00" },
      "thursday": { "available": true, "startTime": "09:00", "endTime": "17:00" },
      "friday": { "available": true, "startTime": "09:00", "endTime": "17:00" },
      "saturday": { "available": false },
      "sunday": { "available": false }
    },
    "unavailableDates": [
      "2025-12-25",
      "2025-12-26"
    ]
  }
}
```

---

## 🏢 Departments

Manage organizational departments.

### GET /api/departments

Get all departments.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Engineering",
      "description": "Software development team",
      "parentId": null,
      "managerId": 2,
      "managerName": "Jane Smith",
      "budget": 500000,
      "isActive": true,
      "employeeCount": 15,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### GET /api/departments/:id

Get a specific department by ID.

**URL Parameters:**

- `id` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Engineering",
    "description": "Software development team",
    "parentId": null,
    "managerId": 2,
    "managerName": "Jane Smith",
    "budget": 500000,
    "isActive": true,
    "employees": [
      {
        "id": 1,
        "name": "John Doe",
        "position": "Senior Developer"
      }
    ],
    "subDepartments": []
  }
}
```

### POST /api/departments

Create a new department.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "name": "Marketing",
  "description": "Marketing and communications team",
  "parentId": null,
  "managerId": 5,
  "budget": 300000
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Marketing",
    "description": "Marketing and communications team",
    "managerId": 5,
    "budget": 300000
  }
}
```

### PUT /api/departments/:id

Update an existing department.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Department ID

**Request Body:**

```json
{
  "name": "Marketing & Communications",
  "budget": 350000,
  "managerId": 6
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Marketing & Communications",
    "budget": 350000
  },
  "message": "Department updated successfully"
}
```

### DELETE /api/departments/:id

Delete a department.

**Required Roles:** `admin`

**URL Parameters:**

- `id` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Department deleted successfully"
}
```

### GET /api/departments/:id/employees

Get all employees in a department.

**URL Parameters:**

- `id` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "firstName": "John",
      "lastName": "Doe",
      "position": "Senior Developer",
      "employeeId": "EMP001",
      "email": "john.doe@example.com"
    }
  ]
}
```

---

## 🕐 Shifts

Manage shift templates and shift instances.

### Shift Templates

### GET /api/shifts/templates

Get all shift templates.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Morning Shift",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "departmentId": 1,
      "departmentName": "Engineering",
      "requiredStaff": 5,
      "color": "#4CAF50",
      "description": "Regular morning shift",
      "breakDuration": 60,
      "isActive": true
    }
  ]
}
```

### GET /api/shifts/templates/:id

Get a specific shift template.

**URL Parameters:**

- `id` (number) - Template ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Morning Shift",
    "startTime": "08:00:00",
    "endTime": "16:00:00",
    "departmentId": 1,
    "requiredStaff": 5,
    "color": "#4CAF50",
    "description": "Regular morning shift",
    "breakDuration": 60
  }
}
```

### POST /api/shifts/templates

Create a new shift template.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "name": "Night Shift",
  "startTime": "22:00:00",
  "endTime": "06:00:00",
  "departmentId": 1,
  "requiredStaff": 3,
  "color": "#2196F3",
  "description": "Overnight shift",
  "breakDuration": 30
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Night Shift",
    "startTime": "22:00:00",
    "endTime": "06:00:00",
    "requiredStaff": 3
  },
  "message": "Shift template created successfully"
}
```

### PUT /api/shifts/templates/:id

Update a shift template.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Template ID

**Request Body:**

```json
{
  "name": "Night Shift - Updated",
  "requiredStaff": 4,
  "color": "#1976D2"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Night Shift - Updated",
    "requiredStaff": 4
  },
  "message": "Shift template updated successfully"
}
```

### DELETE /api/shifts/templates/:id

Delete a shift template.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Template ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Shift template deleted successfully"
}
```

### Shift Instances

### GET /api/shifts

Get all shift instances.

**Query Parameters:**

- `scheduleId` (number, optional) - Filter by schedule ID
- `departmentId` (number, optional) - Filter by department ID
- `startDate` (string, optional) - Filter by start date (YYYY-MM-DD)
- `endDate` (string, optional) - Filter by end date (YYYY-MM-DD)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "scheduleId": 1,
      "templateId": 1,
      "date": "2025-10-29",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "requiredStaff": 5,
      "assignedStaff": 5,
      "status": "published",
      "departmentId": 1,
      "departmentName": "Engineering"
    }
  ]
}
```

### GET /api/shifts/:id

Get a specific shift instance.

**URL Parameters:**

- `id` (number) - Shift ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "scheduleId": 1,
    "templateId": 1,
    "date": "2025-10-29",
    "startTime": "08:00:00",
    "endTime": "16:00:00",
    "requiredStaff": 5,
    "assignedStaff": 5,
    "status": "published",
    "assignments": [
      {
        "assignmentId": 1,
        "employeeId": 1,
        "employeeName": "John Doe"
      }
    ]
  }
}
```

### POST /api/shifts

Create a new shift instance.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "scheduleId": 1,
  "templateId": 1,
  "date": "2025-11-01",
  "startTime": "08:00:00",
  "endTime": "16:00:00",
  "requiredStaff": 5
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 15,
    "scheduleId": 1,
    "templateId": 1,
    "date": "2025-11-01"
  },
  "message": "Shift created successfully"
}
```

---

## 📅 Schedules

Manage work schedules.

### GET /api/schedules

Get all schedules.

**Query Parameters:**

- `status` (string, optional) - Filter by status (`draft`, `published`, `archived`)
- `departmentId` (number, optional) - Filter by department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "November 2025 Schedule",
      "startDate": "2025-11-01",
      "endDate": "2025-11-30",
      "departmentId": 1,
      "departmentName": "Engineering",
      "status": "published",
      "createdBy": 1,
      "createdByName": "Admin User",
      "totalShifts": 150,
      "assignedShifts": 145,
      "createdAt": "2025-10-15T10:00:00Z"
    }
  ]
}
```

### GET /api/schedules/:id

Get a specific schedule.

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "November 2025 Schedule",
    "startDate": "2025-11-01",
    "endDate": "2025-11-30",
    "departmentId": 1,
    "departmentName": "Engineering",
    "status": "published",
    "createdBy": 1,
    "totalShifts": 150,
    "assignedShifts": 145,
    "notes": "Standard monthly schedule"
  }
}
```

### GET /api/schedules/:id/shifts

Get schedule with all shifts.

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "November 2025 Schedule",
    "startDate": "2025-11-01",
    "endDate": "2025-11-30",
    "status": "published",
    "shifts": [
      {
        "id": 1,
        "date": "2025-11-01",
        "startTime": "08:00:00",
        "endTime": "16:00:00",
        "templateName": "Morning Shift",
        "requiredStaff": 5,
        "assignments": [...]
      }
    ]
  }
}
```

### POST /api/schedules

Create a new schedule.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "name": "December 2025 Schedule",
  "startDate": "2025-12-01",
  "endDate": "2025-12-31",
  "departmentId": 1,
  "notes": "Holiday season schedule"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "December 2025 Schedule",
    "startDate": "2025-12-01",
    "endDate": "2025-12-31",
    "status": "draft"
  },
  "message": "Schedule created successfully"
}
```

### PUT /api/schedules/:id

Update a schedule.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Request Body:**

```json
{
  "name": "December 2025 Schedule - Updated",
  "notes": "Updated holiday schedule with additional coverage"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 2,
    "name": "December 2025 Schedule - Updated"
  },
  "message": "Schedule updated successfully"
}
```

### PUT /api/schedules/:id/publish

Publish a schedule (change status from draft to published).

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 2,
    "status": "published"
  },
  "message": "Schedule published successfully"
}
```

### DELETE /api/schedules/:id

Delete a schedule.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Schedule deleted successfully"
}
```

### POST /api/schedules/:id/optimize

Optimize schedule assignments using AI algorithm.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Request Body:**

```json
{
  "algorithm": "simulated_annealing",
  "maxIterations": 10000,
  "temperature": 100,
  "coolingRate": 0.95
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "scheduleId": 2,
    "optimizationScore": 87.5,
    "constraintsViolated": 0,
    "assignmentsMade": 145,
    "unassignedShifts": 5,
    "executionTime": 12.5
  },
  "message": "Schedule optimized successfully"
}
```

---

## 📌 Assignments

Manage shift assignments to employees.

### GET /api/assignments

Get all assignments.

**Query Parameters:**

- `scheduleId` (number, optional) - Filter by schedule ID
- `employeeId` (number, optional) - Filter by employee ID
- `startDate` (string, optional) - Filter by start date (YYYY-MM-DD)
- `endDate` (string, optional) - Filter by end date (YYYY-MM-DD)
- `status` (string, optional) - Filter by status (`scheduled`, `completed`, `cancelled`)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "scheduleId": 1,
      "shiftId": 1,
      "employeeId": 1,
      "employeeName": "John Doe",
      "employeeNumber": "EMP001",
      "assignmentDate": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "status": "scheduled",
      "notes": null,
      "createdAt": "2025-10-25T14:30:00Z"
    }
  ]
}
```

### GET /api/assignments/:id

Get a specific assignment.

**URL Parameters:**

- `id` (number) - Assignment ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "scheduleId": 1,
    "scheduleName": "November 2025 Schedule",
    "shiftId": 1,
    "shiftName": "Morning Shift",
    "employeeId": 1,
    "employeeName": "John Doe",
    "assignmentDate": "2025-11-01",
    "startTime": "08:00:00",
    "endTime": "16:00:00",
    "status": "scheduled",
    "notes": null
  }
}
```

### POST /api/assignments

Create a new assignment.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "scheduleId": 1,
  "shiftId": 1,
  "employeeId": 5,
  "assignmentDate": "2025-11-01",
  "notes": "Covering for sick leave"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 50,
    "scheduleId": 1,
    "shiftId": 1,
    "employeeId": 5,
    "assignmentDate": "2025-11-01",
    "status": "scheduled"
  },
  "message": "Assignment created successfully"
}
```

### POST /api/assignments/bulk

Create multiple assignments at once.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "assignments": [
    {
      "scheduleId": 1,
      "shiftId": 1,
      "employeeId": 1,
      "assignmentDate": "2025-11-01"
    },
    {
      "scheduleId": 1,
      "shiftId": 1,
      "employeeId": 2,
      "assignmentDate": "2025-11-01"
    }
  ]
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "created": 2,
    "failed": 0,
    "assignments": [51, 52]
  },
  "message": "2 assignments created successfully"
}
```

### PUT /api/assignments/:id

Update an assignment.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Assignment ID

**Request Body:**

```json
{
  "employeeId": 3,
  "status": "completed",
  "notes": "Successfully completed"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 50,
    "employeeId": 3,
    "status": "completed"
  },
  "message": "Assignment updated successfully"
}
```

### DELETE /api/assignments/:id

Delete an assignment.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Assignment ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Assignment deleted successfully"
}
```

### GET /api/assignments/employee/:employeeId

Get all assignments for a specific employee.

**URL Parameters:**

- `employeeId` (number) - Employee ID

**Query Parameters:**

- `startDate` (string, optional) - Start date (YYYY-MM-DD)
- `endDate` (string, optional) - End date (YYYY-MM-DD)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "assignmentDate": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "shiftName": "Morning Shift",
      "departmentName": "Engineering",
      "status": "scheduled"
    }
  ]
}
```

### GET /api/assignments/conflicts

Check for scheduling conflicts.

**Query Parameters:**

- `scheduleId` (number, required) - Schedule ID to check

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "hasConflicts": true,
    "conflicts": [
      {
        "type": "double_booking",
        "employeeId": 1,
        "employeeName": "John Doe",
        "date": "2025-11-05",
        "assignments": [
          {
            "id": 10,
            "shiftName": "Morning Shift",
            "time": "08:00-16:00"
          },
          {
            "id": 11,
            "shiftName": "Afternoon Shift",
            "time": "14:00-22:00"
          }
        ]
      },
      {
        "type": "max_hours_exceeded",
        "employeeId": 2,
        "employeeName": "Jane Smith",
        "weekOf": "2025-11-03",
        "totalHours": 45,
        "maxHours": 40
      }
    ]
  }
}
```

---

## 📊 Dashboard

Get dashboard statistics and analytics.

### GET /api/dashboard/stats

Get overall system statistics.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "totalEmployees": 142,
    "activeSchedules": 8,
    "todayShifts": 24,
    "pendingApprovals": 6,
    "monthlyHours": 3248,
    "monthlyCost": 48720,
    "coverageRate": 92.5,
    "employeeSatisfaction": 87.2
  }
}
```

### GET /api/dashboard/activities

Get recent system activities.

**Query Parameters:**

- `limit` (number, optional) - Limit number of activities (default: 10)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "schedule_published",
      "description": "Schedule 'November 2025' published",
      "userId": 1,
      "userName": "Admin User",
      "timestamp": "2025-10-29T10:30:00Z"
    },
    {
      "id": 2,
      "type": "employee_created",
      "description": "New employee 'John Doe' added",
      "userId": 1,
      "userName": "Admin User",
      "timestamp": "2025-10-28T14:15:00Z"
    }
  ]
}
```

### GET /api/dashboard/metrics

Get detailed performance metrics.

**Query Parameters:**

- `period` (string, optional) - Period for metrics (`day`, `week`, `month`, `year`)
- `departmentId` (number, optional) - Filter by department

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "period": "month",
    "metrics": {
      "totalHours": 3248,
      "overtime": 124,
      "absences": 18,
      "coverage": {
        "scheduled": 92.5,
        "actual": 89.3
      },
      "costAnalysis": {
        "regularHours": 38500,
        "overtime": 6720,
        "total": 45220
      },
      "employeeMetrics": {
        "averageHoursPerEmployee": 22.8,
        "utilizationRate": 85.7
      }
    }
  }
}
```

### GET /api/dashboard/charts/coverage

Get shift coverage data for charts.

**Query Parameters:**

- `startDate` (string, required) - Start date (YYYY-MM-DD)
- `endDate` (string, required) - End date (YYYY-MM-DD)
- `departmentId` (number, optional) - Filter by department

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "labels": ["Nov 1", "Nov 2", "Nov 3", "Nov 4", "Nov 5"],
    "datasets": [
      {
        "label": "Required Staff",
        "data": [20, 22, 21, 23, 20]
      },
      {
        "label": "Assigned Staff",
        "data": [19, 22, 20, 23, 18]
      }
    ]
  }
}
```

---

## ⚙️ System Settings

Manage system-wide configuration settings.

### GET /api/settings

Get all system settings.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "category": "general",
      "settingKey": "app_name",
      "settingValue": "Staff Scheduler",
      "dataType": "string",
      "description": "Application name"
    },
    {
      "id": 2,
      "category": "scheduling",
      "settingKey": "default_shift_duration",
      "settingValue": "8",
      "dataType": "number",
      "description": "Default shift duration in hours"
    },
    {
      "id": 3,
      "category": "display",
      "settingKey": "currency",
      "settingValue": "EUR",
      "dataType": "string",
      "description": "Currency symbol (EUR or USD)"
    },
    {
      "id": 4,
      "category": "display",
      "settingKey": "time_period",
      "settingValue": "Monthly",
      "dataType": "string",
      "description": "Default time period view"
    }
  ]
}
```

### GET /api/settings/category/:category

Get settings by category.

**URL Parameters:**

- `category` (string) - Category name (`general`, `scheduling`, `display`, `notifications`, etc.)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "category": "display",
      "settingKey": "currency",
      "settingValue": "EUR",
      "dataType": "string"
    },
    {
      "id": 4,
      "category": "display",
      "settingKey": "time_period",
      "settingValue": "Monthly",
      "dataType": "string"
    }
  ]
}
```

### GET /api/settings/:category/:key

Get a specific setting value.

**URL Parameters:**

- `category` (string) - Category name
- `key` (string) - Setting key

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "category": "display",
    "key": "currency",
    "value": "EUR"
  }
}
```

### PUT /api/settings/:category/:key

Update a setting value.

**Required Roles:** `admin`

**URL Parameters:**

- `category` (string) - Category name
- `key` (string) - Setting key

**Request Body:**

```json
{
  "value": "USD"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "category": "display",
    "key": "currency",
    "value": "USD"
  },
  "message": "Setting updated successfully"
}
```

### POST /api/settings/bulk

Update multiple settings at once.

**Required Roles:** `admin`

**Request Body:**

```json
{
  "settings": [
    {
      "category": "display",
      "key": "currency",
      "value": "USD"
    },
    {
      "category": "display",
      "key": "time_period",
      "value": "Weekly"
    }
  ]
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "updated": 2
  },
  "message": "2 settings updated successfully"
}
```

---

## ❌ Error Handling

All API endpoints follow a consistent error response format.

### Error Response Structure

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional error details"
    }
  }
}
```

### Common HTTP Status Codes

- `200 OK` - Request succeeded
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters or validation errors
- `401 Unauthorized` - Authentication required or invalid token
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource conflict (e.g., duplicate entry)
- `422 Unprocessable Entity` - Validation error
- `500 Internal Server Error` - Server error

### Common Error Codes

- `VALIDATION_ERROR` - Input validation failed
- `AUTHENTICATION_REQUIRED` - User must be authenticated
- `INVALID_CREDENTIALS` - Invalid username or password
- `INSUFFICIENT_PERMISSIONS` - User lacks required permissions
- `NOT_FOUND` - Requested resource not found
- `DUPLICATE_ENTRY` - Resource already exists
- `CONSTRAINT_VIOLATION` - Business rule or constraint violated
- `SERVER_ERROR` - Internal server error

### Example Error Responses

**400 Bad Request - Validation Error:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "email": "Email is required",
      "password": "Password must be at least 8 characters"
    }
  }
}
```

**401 Unauthorized:**

```json
{
  "success": false,
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Authentication token is missing or invalid"
  }
}
```

**403 Forbidden:**

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_PERMISSIONS",
    "message": "You do not have permission to perform this action"
  }
}
```

**404 Not Found:**

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Employee with ID 999 not found"
  }
}
```

**409 Conflict:**

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_ENTRY",
    "message": "An employee with this email already exists"
  }
}
```

---

## ✅ Response Format

All successful API responses follow a consistent format.

### Success Response Structure

```json
{
  "success": true,
  "data": {
    // Response data here
  },
  "message": "Optional success message"
}
```

### Pagination

For endpoints that return lists, pagination is supported:

**Request:**

```http
GET /api/employees?page=2&limit=20
```

**Response:**

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 142,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": true
  }
}
```

### Filtering and Sorting

Most list endpoints support filtering and sorting:

**Filtering:**

```http
GET /api/employees?department=1&status=active
```

**Sorting:**

```http
GET /api/employees?sortBy=lastName&sortOrder=asc
```

**Combined:**

```http
GET /api/employees?department=1&sortBy=hireDate&sortOrder=desc&page=1&limit=50
```

---

## 🔧 Rate Limiting

API requests are rate-limited to prevent abuse:

- **General endpoints:** 100 requests per 15 minutes per IP
- **Authentication endpoints:** 5 requests per 15 minutes per IP

Rate limit information is included in response headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1635523200
```

When rate limit is exceeded:

**Response:** `429 Too Many Requests`

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 300
  }
}
```

---

## 🔒 Security Best Practices

### API Key Security

- Store JWT tokens securely (HttpOnly cookies or secure storage)
- Never expose tokens in URLs
- Regenerate tokens periodically
- Implement token refresh mechanism

### HTTPS

Always use HTTPS in production:

```
https://api.staffscheduler.com/api/
```

### CORS

Configure CORS appropriately for your frontend domain:

```javascript
// Allowed origins
https://app.staffscheduler.com
http://localhost:3000 (development only)
```

### Input Validation

All input is validated on the server side. Client-side validation is supplementary.

### SQL Injection Prevention

All database queries use parameterized statements to prevent SQL injection.

---

## 📝 Changelog

### Version 1.0.0 (2025-10-29)

- Initial API release
- Complete CRUD operations for all entities
- Authentication and authorization
- Dashboard analytics endpoints
- Schedule optimization algorithms
- Real-time conflict detection

---

## 📞 Support

For API support or questions:

- **Documentation:** [Technical Documentation](./TECHNICAL.md)
- **Issues:** [GitHub Issues](https://github.com/lucaosti/StaffScheduler/issues)
- **Email:** support@staffscheduler.com

---

<div align="center">

**Staff Scheduler API** - Version 1.0.0

Developed with ❤️ by Luca Ostinelli

*Last Updated: October 29, 2025*

</div>
