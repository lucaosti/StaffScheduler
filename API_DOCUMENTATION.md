# Staff Scheduler - API Documentation

> **Complete REST API Reference for Staff Scheduler Backend**

Version: 1.0.0  
Base URL: `http://localhost:3001/api`  
Authentication: JWT Bearer Token

---

## Table of Contents

1. [Authentication](#authentication)
2. [Users](#users)
3. [Employees](#employees)
4. [Departments](#departments)
5. [Shifts](#shifts)
6. [Schedules](#schedules)
7. [Assignments](#assignments)
8. [Dashboard](#dashboard)
9. [System Settings](#system-settings)
10. [Health](#health)
11. [Error Handling](#error-handling)
12. [Response Format](#response-format)

---

## Authentication

All API endpoints (except login) require authentication via JWT token.

### Authentication Header

```http
Authorization: Bearer <your-jwt-token>
```

### POST /api/auth/login

Authenticate a user and receive a JWT token.

**Request Body:**

```json
{
  "email": "admin@example.com",
  "password": "YourPassword123!"
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
      "email": "admin@example.com",
      "firstName": "Admin",
      "lastName": "User",
      "role": "admin"
    }
  }
}
```

**Error Responses:**

- `400 Bad Request` - Missing email or password
- `401 Unauthorized` - Invalid credentials

### GET /api/auth/verify

Verify JWT token validity and get current authenticated user information.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@example.com",
    "firstName": "Admin",
    "lastName": "User",
    "role": "admin",
    "employeeId": "EMP001",
    "phone": "+1234567890",
    "isActive": true,
    "lastLogin": "2025-10-29T10:30:00Z",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-10-29T10:30:00Z"
  }
}
```

**Error Responses:**

- `401 Unauthorized` - Invalid or expired token

### POST /api/auth/refresh

Refresh the JWT token to extend the session.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "admin@example.com",
      "firstName": "Admin",
      "lastName": "User",
      "role": "admin"
    }
  }
}
```

**Error Responses:**

- `401 Unauthorized` - Invalid or expired token

### POST /api/auth/logout

Logout the current user. In JWT-based authentication, logout is primarily handled client-side by removing the stored token.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Users

Manage system users with role-based permissions. Users are the central entity; employees are users with `role: "employee"`.

### Roles

The system supports three roles:

| Role | Description |
|------|-------------|
| `admin` | Full system access |
| `manager` | Manage departments, schedules, shifts, assignments |
| `employee` | View own data, confirm/decline assignments |

### GET /api/users

Get all users (with role-based filtering).

**Headers:** `Authorization: Bearer <token>` (required)

**Query Parameters:**

- `search` (string, optional) - Search by name, email, or employee ID
- `department` (number, optional) - Filter by department ID
- `role` (string, optional) - Filter by role (`admin`, `manager`, `employee`)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "email": "admin@example.com",
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
          "id": 1,
          "name": "Engineering"
        }
      ]
    }
  ]
}
```

> **Note:** Admins see all users. Managers see only users in their departments, with client-side filtering applied.

### GET /api/users/:id

Get a specific user by ID.

**Headers:** `Authorization: Bearer <token>` (required)

**URL Parameters:**

- `id` (number) - User ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@example.com",
    "firstName": "Admin",
    "lastName": "User",
    "role": "admin",
    "employeeId": "EMP001",
    "phone": "+1234567890",
    "isActive": true,
    "departments": [
      {
        "id": 1,
        "name": "Engineering"
      }
    ]
  }
}
```

**Error Responses:**

- `403 Forbidden` - Employees can only view their own profile
- `404 Not Found` - User not found

### POST /api/users

Create a new user.

**Required Roles:** `admin`, `manager`

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
  "departmentIds": [1, 2],
  "skillIds": [1, 3]
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

- `400 Bad Request` - Missing required fields (email, password, firstName, lastName, role) or duplicate email/employeeId
- `403 Forbidden` - Insufficient permissions

### PUT /api/users/:id

Update an existing user.

**Required Roles:** `admin`, `manager` (or own profile for employees with limited fields)

**URL Parameters:**

- `id` (number) - User ID

**Request Body:**

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phone": "+0987654321",
  "isActive": true
}
```

> **Note:** Employees can only update `firstName`, `lastName`, and `phone` on their own profile.

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
  }
}
```

**Error Responses:**

- `400 Bad Request` - Duplicate email or employee ID
- `403 Forbidden` - Insufficient permissions or restricted fields
- `404 Not Found` - User not found

### DELETE /api/users/:id

Delete a user (soft delete - sets `isActive` to false).

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - User ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

**Error Responses:**

- `400 Bad Request` - Cannot delete yourself
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - User not found

---

## Employees

Manage employee-specific data. Employees are users with `role: "employee"` in the `users` table. The employee endpoints provide employee-focused views and operations.

### GET /api/employees

Get all employees.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "email": "john.doe@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "employee",
      "employeeId": "EMP001",
      "phone": "+1234567890",
      "position": "Senior Developer",
      "hourlyRate": 25.00,
      "isActive": true,
      "departments": [
        {
          "id": 1,
          "name": "Engineering"
        }
      ]
    }
  ]
}
```

### GET /api/employees/:id

Get a specific employee by ID.

**URL Parameters:**

- `id` (number) - User ID of the employee

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "john.doe@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "employee",
    "employeeId": "EMP001",
    "position": "Senior Developer",
    "hourlyRate": 25.00,
    "isActive": true
  }
}
```

**Error Responses:**

- `404 Not Found` - Employee not found

### POST /api/employees

Create a new employee.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "email": "newemployee@example.com",
  "password": "SecurePass123!",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "employee",
  "employeeId": "EMP010",
  "position": "Developer",
  "phone": "+1234567890"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 10,
    "email": "newemployee@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "employeeId": "EMP010"
  },
  "message": "Employee created successfully"
}
```

### PUT /api/employees/:id

Update an existing employee.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - User ID of the employee

**Request Body:**

```json
{
  "position": "Senior Developer",
  "phone": "+0987654321"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 10,
    "position": "Senior Developer",
    "phone": "+0987654321"
  },
  "message": "Employee updated successfully"
}
```

### DELETE /api/employees/:id

Delete an employee (soft delete).

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - User ID of the employee

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Employee deleted successfully"
}
```

### GET /api/employees/department/:departmentId

Get all employees in a specific department.

**URL Parameters:**

- `departmentId` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "firstName": "John",
      "lastName": "Doe",
      "employeeId": "EMP001",
      "email": "john.doe@example.com"
    }
  ]
}
```

### GET /api/employees/:id/skills

Get all skills for a specific employee.

**URL Parameters:**

- `id` (number) - User ID of the employee

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "JavaScript",
      "proficiencyLevel": 5
    }
  ]
}
```

### POST /api/employees/:id/skills

Add a skill to an employee.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - User ID of the employee

**Request Body:**

```json
{
  "skillId": 1,
  "proficiencyLevel": 4
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Skill added to employee successfully"
}
```

### DELETE /api/employees/:id/skills/:skillId

Remove a skill from an employee.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - User ID of the employee
- `skillId` (number) - Skill ID to remove

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Skill removed from employee successfully"
}
```

---

## Departments

Manage organizational departments.

### GET /api/departments

Get all departments.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Engineering",
      "description": "Software development team",
      "managerId": 2,
      "managerName": "Jane Smith",
      "isActive": true,
      "employeeCount": 15,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-06-15T08:00:00Z"
    }
  ]
}
```

> **Note:** Admins see all departments. Non-admin users see only departments they belong to.

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
    "managerId": 2,
    "managerName": "Jane Smith",
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-06-15T08:00:00Z"
  }
}
```

**Error Responses:**

- `403 Forbidden` - Non-admin users can only access departments they belong to
- `404 Not Found` - Department not found

### POST /api/departments

Create a new department.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "name": "Marketing",
  "description": "Marketing and communications team",
  "managerId": 5
}
```

> **Note:** If `managerId` is specified, the referenced user must exist and have role `admin` or `manager`.

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Marketing",
    "description": "Marketing and communications team",
    "managerId": 5
  }
}
```

**Error Responses:**

- `400 Bad Request` - Department name is required, or specified manager not found/invalid role

### PUT /api/departments/:id

Update an existing department.

**Required Roles:** `admin`, or `manager` (only for departments they manage)

**URL Parameters:**

- `id` (number) - Department ID

**Request Body:**

```json
{
  "name": "Marketing & Communications",
  "description": "Updated description",
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
    "managerId": 6
  }
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
  "data": {
    "message": "Department deleted successfully"
  }
}
```

**Error Responses:**

- `400 Bad Request` - Cannot delete department with active users
- `403 Forbidden` - Only administrators can delete departments

### POST /api/departments/:id/users

Add a user to a department.

**Required Roles:** `admin`, or `manager` (only for departments they manage)

**URL Parameters:**

- `id` (number) - Department ID

**Request Body:**

```json
{
  "userId": 5
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "User added to department successfully"
  }
}
```

**Error Responses:**

- `400 Bad Request` - User not found
- `404 Not Found` - Department not found

### DELETE /api/departments/:id/users/:userId

Remove a user from a department.

**Required Roles:** `admin`, or `manager` (only for departments they manage)

**URL Parameters:**

- `id` (number) - Department ID
- `userId` (number) - User ID to remove

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "User removed from department successfully"
  }
}
```

### GET /api/departments/:id/stats

Get statistics for a department.

**Headers:** `Authorization: Bearer <token>` (required)

**URL Parameters:**

- `id` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "totalEmployees": 15,
    "activeEmployees": 14,
    "totalShifts": 120,
    "coverage": 92.5
  }
}
```

**Error Responses:**

- `403 Forbidden` - Non-admin users can only access stats for departments they belong to

---

## Shifts

Manage shift templates and shift instances.

### Shift Templates

Reusable shift definitions that can be used to create shift instances.

#### GET /api/shifts/templates

Get all shift templates.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Morning Shift",
      "description": "Regular morning shift",
      "departmentId": 1,
      "departmentName": "Engineering",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "minStaff": 3,
      "maxStaff": 8,
      "isActive": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-06-15T08:00:00Z"
    }
  ]
}
```

#### GET /api/shifts/templates/:id

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
    "description": "Regular morning shift",
    "departmentId": 1,
    "startTime": "08:00:00",
    "endTime": "16:00:00",
    "minStaff": 3,
    "maxStaff": 8,
    "isActive": true
  }
}
```

**Error Responses:**

- `404 Not Found` - Shift template not found

#### POST /api/shifts/templates

Create a new shift template.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "name": "Night Shift",
  "description": "Overnight shift",
  "departmentId": 1,
  "startTime": "22:00:00",
  "endTime": "06:00:00",
  "minStaff": 2,
  "maxStaff": 5
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
    "minStaff": 2,
    "maxStaff": 5
  },
  "message": "Shift template created successfully"
}
```

#### PUT /api/shifts/templates/:id

Update a shift template.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Template ID

**Request Body:**

```json
{
  "name": "Night Shift - Updated",
  "minStaff": 3,
  "maxStaff": 6
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 5,
    "name": "Night Shift - Updated",
    "minStaff": 3,
    "maxStaff": 6
  },
  "message": "Shift template updated successfully"
}
```

#### DELETE /api/shifts/templates/:id

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

Individual shift occurrences linked to schedules.

#### GET /api/shifts

Get all shift instances.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "scheduleId": 1,
      "departmentId": 1,
      "departmentName": "Engineering",
      "templateId": 1,
      "date": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "minStaff": 3,
      "maxStaff": 8,
      "assignedStaff": 5,
      "status": "open",
      "notes": null,
      "createdAt": "2025-10-15T10:00:00Z"
    }
  ]
}
```

> **Shift status values:** `open`, `assigned`, `confirmed`, `cancelled`

#### GET /api/shifts/:id

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
    "departmentId": 1,
    "templateId": 1,
    "date": "2025-11-01",
    "startTime": "08:00:00",
    "endTime": "16:00:00",
    "minStaff": 3,
    "maxStaff": 8,
    "assignedStaff": 5,
    "status": "assigned",
    "assignments": [
      {
        "id": 1,
        "userId": 3,
        "userName": "John Doe",
        "status": "confirmed"
      }
    ]
  }
}
```

#### POST /api/shifts

Create a new shift instance.

**Required Roles:** `admin`, `manager`

**Request Body:**

```json
{
  "scheduleId": 1,
  "departmentId": 1,
  "templateId": 1,
  "date": "2025-11-01",
  "startTime": "08:00:00",
  "endTime": "16:00:00",
  "minStaff": 3,
  "maxStaff": 8,
  "notes": "Extra coverage needed"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 15,
    "scheduleId": 1,
    "departmentId": 1,
    "date": "2025-11-01"
  },
  "message": "Shift created successfully"
}
```

#### PUT /api/shifts/:id

Update an existing shift.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Shift ID

**Request Body:**

```json
{
  "minStaff": 4,
  "maxStaff": 10,
  "status": "confirmed",
  "notes": "Updated requirements"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 15,
    "minStaff": 4,
    "maxStaff": 10,
    "status": "confirmed"
  },
  "message": "Shift updated successfully"
}
```

#### DELETE /api/shifts/:id

Delete a shift.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Shift ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Shift deleted successfully"
}
```

#### GET /api/shifts/schedule/:scheduleId

Get all shifts for a specific schedule.

**URL Parameters:**

- `scheduleId` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "scheduleId": 1,
      "date": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "status": "assigned"
    }
  ]
}
```

#### GET /api/shifts/department/:departmentId

Get all shifts for a specific department.

**URL Parameters:**

- `departmentId` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "departmentId": 1,
      "date": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "status": "open"
    }
  ]
}
```

---

## Schedules

Manage work schedules. Schedules are time-bound containers that group shifts for a department.

### GET /api/schedules

Get all schedules.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "November 2025 Schedule",
      "description": "Standard monthly schedule",
      "departmentId": 1,
      "departmentName": "Engineering",
      "startDate": "2025-11-01",
      "endDate": "2025-11-30",
      "status": "published",
      "createdBy": 1,
      "createdByName": "Admin User",
      "notes": "Standard monthly schedule",
      "createdAt": "2025-10-15T10:00:00Z",
      "updatedAt": "2025-10-20T14:00:00Z"
    }
  ]
}
```

> **Schedule status values:** `draft`, `published`, `archived`

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
    "description": "Standard monthly schedule",
    "departmentId": 1,
    "startDate": "2025-11-01",
    "endDate": "2025-11-30",
    "status": "published",
    "createdBy": 1,
    "notes": "Standard monthly schedule"
  }
}
```

### GET /api/schedules/:id/shifts

Get a schedule with all its shifts.

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
        "minStaff": 3,
        "maxStaff": 8,
        "status": "assigned",
        "assignments": [
          {
            "id": 1,
            "userId": 3,
            "userName": "John Doe",
            "status": "confirmed"
          }
        ]
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

> **Note:** The `createdBy` field is automatically set from the authenticated user.

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

### PATCH /api/schedules/:id/publish

Publish a schedule (change status from `draft` to `published`).

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Schedule published successfully"
}
```

### PATCH /api/schedules/:id/archive

Archive a schedule (change status to `archived`).

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Schedule archived successfully"
}
```

### POST /api/schedules/:id/duplicate

Duplicate an existing schedule with new dates.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Source schedule ID

**Request Body:**

```json
{
  "name": "January 2026 Schedule",
  "startDate": "2026-01-01",
  "endDate": "2026-01-31"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 3,
    "name": "January 2026 Schedule",
    "startDate": "2026-01-01",
    "endDate": "2026-01-31",
    "status": "draft"
  },
  "message": "Schedule duplicated successfully"
}
```

**Error Responses:**

- `400 Bad Request` - Name, start date, and end date are required

### POST /api/schedules/:id/generate

Generate optimized schedule assignments using the scheduling algorithm.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Schedule ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "scheduleId": 2,
    "assignmentsCreated": 145,
    "unassignedShifts": 5,
    "coverageRate": 96.7
  },
  "message": "Schedule generated successfully"
}
```

**Error Responses:**

- `404 Not Found` - Schedule not found

### GET /api/schedules/department/:departmentId

Get all schedules for a specific department.

**URL Parameters:**

- `departmentId` (number) - Department ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "November 2025 Schedule",
      "departmentId": 1,
      "startDate": "2025-11-01",
      "endDate": "2025-11-30",
      "status": "published"
    }
  ]
}
```

### GET /api/schedules/user/:userId

Get all schedules associated with a specific user.

**URL Parameters:**

- `userId` (number) - User ID

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
      "status": "published"
    }
  ]
}
```

---

## Assignments

Manage shift assignments to employees. Assignments link users to specific shift instances.

### Assignment Status Values

| Status | Description |
|--------|-------------|
| `pending` | Assignment created, awaiting confirmation |
| `confirmed` | Employee confirmed the assignment |
| `completed` | Shift was completed |
| `cancelled` | Assignment was cancelled |

### GET /api/assignments

Get all assignments.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "shiftId": 1,
      "userId": 3,
      "userName": "John Doe",
      "userEmail": "john.doe@example.com",
      "shiftDate": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "departmentId": 1,
      "departmentName": "Engineering",
      "status": "confirmed",
      "assignedAt": "2025-10-25T14:30:00Z",
      "confirmedAt": "2025-10-26T09:00:00Z",
      "notes": null
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
    "shiftId": 1,
    "userId": 3,
    "userName": "John Doe",
    "shiftDate": "2025-11-01",
    "startTime": "08:00:00",
    "endTime": "16:00:00",
    "status": "confirmed",
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
  "shiftId": 1,
  "userId": 5,
  "notes": "Covering for sick leave"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "id": 50,
    "shiftId": 1,
    "userId": 5,
    "status": "pending"
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
      "shiftId": 1,
      "userId": 3,
      "notes": null
    },
    {
      "shiftId": 1,
      "userId": 4,
      "notes": null
    }
  ]
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "data": {
    "assignmentIds": [51, 52],
    "count": 2
  },
  "message": "2 assignments created successfully"
}
```

**Error Responses:**

- `400 Bad Request` - Assignments must be an array

### PUT /api/assignments/:id

Update an assignment.

**Required Roles:** `admin`, `manager`

**URL Parameters:**

- `id` (number) - Assignment ID

**Request Body:**

```json
{
  "status": "confirmed",
  "notes": "Reassigned and confirmed"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 50,
    "status": "confirmed"
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

### PATCH /api/assignments/:id/confirm

Confirm an assignment.

**Headers:** `Authorization: Bearer <token>` (required)

**URL Parameters:**

- `id` (number) - Assignment ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Assignment confirmed successfully"
}
```

### PATCH /api/assignments/:id/decline

Decline an assignment.

**Headers:** `Authorization: Bearer <token>` (required)

**URL Parameters:**

- `id` (number) - Assignment ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "id": 50,
    "status": "cancelled"
  },
  "message": "Assignment declined successfully"
}
```

### PATCH /api/assignments/:id/complete

Mark an assignment as completed.

**Headers:** `Authorization: Bearer <token>` (required)

**URL Parameters:**

- `id` (number) - Assignment ID

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Assignment completed successfully"
}
```

### GET /api/assignments/user/:userId

Get all assignments for a specific user.

**URL Parameters:**

- `userId` (number) - User ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "shiftId": 1,
      "shiftDate": "2025-11-01",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "departmentName": "Engineering",
      "status": "confirmed"
    }
  ]
}
```

### GET /api/assignments/shift/:shiftId

Get all assignments for a specific shift.

**URL Parameters:**

- `shiftId` (number) - Shift ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "userId": 3,
      "userName": "John Doe",
      "status": "confirmed",
      "assignedAt": "2025-10-25T14:30:00Z"
    }
  ]
}
```

### GET /api/assignments/department/:departmentId

Get all assignments for a specific department.

**URL Parameters:**

- `departmentId` (number) - Department ID

**Query Parameters:**

- `status` (string, optional) - Filter by status (`pending`, `confirmed`, `completed`, `cancelled`)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "shiftId": 1,
      "userId": 3,
      "userName": "John Doe",
      "status": "confirmed"
    }
  ]
}
```

### GET /api/assignments/shift/:shiftId/available-employees

Get employees available for a specific shift (not already assigned and not unavailable).

**URL Parameters:**

- `shiftId` (number) - Shift ID

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 5,
      "firstName": "Jane",
      "lastName": "Smith",
      "employeeId": "EMP005",
      "email": "jane.smith@example.com"
    }
  ]
}
```

---

## Dashboard

Get dashboard statistics and analytics.

### GET /api/dashboard/stats

Get overall system statistics and KPIs.

**Headers:** `Authorization: Bearer <token>` (required)

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
    "monthlyCost": 48720.50,
    "coverageRate": 92.5,
    "employeeSatisfaction": 0
  }
}
```

> **Field details:**
> - `totalEmployees` - Count of active users with role `employee`
> - `activeSchedules` - Count of schedules with status `published`
> - `todayShifts` - Count of today's shifts with status `open`, `assigned`, or `confirmed`
> - `pendingApprovals` - Count of shift assignments with status `pending`
> - `monthlyHours` - Total hours from confirmed assignments in the current month
> - `monthlyCost` - Total cost based on confirmed hours multiplied by employee hourly rates
> - `coverageRate` - Percentage of current month's shifts that have at least one confirmed assignment
> - `employeeSatisfaction` - Placeholder (currently returns 0)

### GET /api/dashboard/activities

Get recent system activities from the audit log.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "type": "schedule_published",
      "message": "Schedule 'November 2025' published",
      "timestamp": "2025-10-29T10:30:00.000Z",
      "user": "Admin User"
    },
    {
      "id": "2",
      "type": "employee_created",
      "message": "New employee 'John Doe' added",
      "timestamp": "2025-10-28T14:15:00.000Z",
      "user": "Admin User"
    }
  ]
}
```

> **Note:** Returns the 10 most recent entries from the `audit_logs` table. If no audit logs exist, returns an empty array.

### GET /api/dashboard/upcoming-shifts

Get upcoming shifts for the next 3 days with staffing information.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "Engineering - 2025-11-01",
      "department": "Engineering",
      "startTime": "08:00:00",
      "endTime": "16:00:00",
      "assignedEmployees": 4,
      "requiredEmployees": 5,
      "status": "understaffed"
    },
    {
      "id": "2",
      "name": "Marketing - 2025-11-01",
      "department": "Marketing",
      "startTime": "09:00:00",
      "endTime": "17:00:00",
      "assignedEmployees": 3,
      "requiredEmployees": 3,
      "status": "adequate"
    }
  ]
}
```

> **Staffing status:** `understaffed` (assigned < required), `adequate` (assigned = required), `overstaffed` (assigned > required)

### GET /api/dashboard/departments

Get department overview with employee counts.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "department": "Engineering",
      "total_employees": 15,
      "active_employees": 14,
      "employee_count": 12,
      "manager_count": 2
    }
  ]
}
```

---

## System Settings

Manage system-wide configuration settings.

### GET /api/settings

Get all system settings.

**Headers:** `Authorization: Bearer <token>` (required)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "category": "general",
      "key": "currency",
      "value": "EUR",
      "type": "string",
      "defaultValue": "EUR",
      "description": "Default currency for the application (EUR or USD)",
      "isEditable": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": 2,
      "category": "general",
      "key": "time_period",
      "value": "monthly",
      "type": "string",
      "defaultValue": "monthly",
      "description": "Default time period for scheduling (monthly, weekly, daily)",
      "isEditable": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": 3,
      "category": "scheduling",
      "key": "max_shifts_per_week",
      "value": "5",
      "type": "number",
      "defaultValue": "5",
      "description": "Maximum number of shifts an employee can work per week",
      "isEditable": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    },
    {
      "id": 4,
      "category": "scheduling",
      "key": "min_hours_between_shifts",
      "value": "8",
      "type": "number",
      "defaultValue": "8",
      "description": "Minimum hours required between shifts for the same employee",
      "isEditable": true,
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### GET /api/settings/category/:category

Get settings by category.

**URL Parameters:**

- `category` (string) - Category name (`general`, `scheduling`, etc.)

**Response:** `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "category": "general",
      "key": "currency",
      "value": "EUR",
      "type": "string"
    },
    {
      "id": 2,
      "category": "general",
      "key": "time_period",
      "value": "monthly",
      "type": "string"
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
    "category": "general",
    "key": "currency",
    "value": "EUR"
  }
}
```

**Error Responses:**

- `404 Not Found` - Setting not found

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
    "category": "general",
    "key": "currency",
    "value": "USD"
  },
  "message": "Setting updated successfully"
}
```

**Error Responses:**

- `400 Bad Request` - Invalid value (e.g., currency must be EUR or USD)
- `403 Forbidden` - Only administrators can modify settings, or setting is not editable
- `404 Not Found` - Setting not found

### POST /api/settings/:category/:key/reset

Reset a setting to its default value.

**Required Roles:** `admin`

**URL Parameters:**

- `category` (string) - Category name
- `key` (string) - Setting key

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Setting reset to default value successfully"
}
```

**Error Responses:**

- `404 Not Found` - Setting not found

### Convenience Endpoints

#### GET /api/settings/currency

Get the current currency setting.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "currency": "EUR"
  }
}
```

#### PUT /api/settings/currency

Update the currency setting.

**Required Roles:** `admin`

**Request Body:**

```json
{
  "currency": "USD"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "currency": "USD"
  },
  "message": "Currency updated successfully"
}
```

**Error Responses:**

- `400 Bad Request` - Currency must be EUR or USD

#### GET /api/settings/time-period

Get the current time period setting.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "timePeriod": "monthly"
  }
}
```

#### PUT /api/settings/time-period

Update the time period setting.

**Required Roles:** `admin`

**Request Body:**

```json
{
  "timePeriod": "weekly"
}
```

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "timePeriod": "weekly"
  },
  "message": "Time period updated successfully"
}
```

**Error Responses:**

- `400 Bad Request` - Time period must be `daily`, `weekly`, `monthly`, or `yearly`

---

## Health

System health monitoring endpoints. These endpoints do not require authentication.

### GET /api/health

Returns system health status and performance metrics.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-11-01T10:30:00.000Z",
    "uptime": 86400,
    "version": "1.0.0",
    "environment": "development",
    "services": {
      "database": "connected",
      "memory": {
        "used": 45,
        "total": 128,
        "unit": "MB"
      },
      "cpu": {
        "user": 123456,
        "system": 654321
      }
    }
  }
}
```

**Error Responses:**

- `503 Service Unavailable` - Health check failed

### GET /api/health/ready

Readiness check for orchestrators (e.g. Kubernetes). Returns whether the service is ready to accept requests.

**Response:** `200 OK`

```json
{
  "success": true,
  "data": {
    "status": "ready"
  }
}
```

**Error Responses:**

- `503 Service Unavailable` - Service not ready

---

## Error Handling

All API endpoints follow a consistent error response format.

### Error Response Structure

`error.code` is optional: many routes return only `error.message`.

```json
{
  "success": false,
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE",
    "details": "Additional error context (development only)"
  }
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200 OK` | Request succeeded |
| `201 Created` | Resource created successfully |
| `400 Bad Request` | Invalid request parameters or validation errors |
| `401 Unauthorized` | Authentication required or invalid token |
| `403 Forbidden` | Insufficient permissions |
| `404 Not Found` | Resource not found |
| `500 Internal Server Error` | Server error |
| `503 Service Unavailable` | Service health check failure |

### Common Error Codes

- `VALIDATION_ERROR` - Input validation failed
- `UNAUTHORIZED` - User not authenticated
- `LOGIN_FAILED` - Invalid email or password
- `INSUFFICIENT_PERMISSIONS` - User lacks required role
- `NOT_FOUND` - Requested resource not found
- `INTERNAL_ERROR` - Internal server error

### Example Error Responses

**400 Bad Request - Validation Error:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email and password are required"
  }
}
```

**401 Unauthorized:**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "User not found"
  }
}
```

**403 Forbidden:**

```json
{
  "success": false,
  "error": {
    "message": "Insufficient permissions"
  }
}
```

**404 Not Found:**

```json
{
  "success": false,
  "error": {
    "message": "Employee not found"
  }
}
```

---

## Response Format

All successful API responses follow a consistent format.

### Success Response Structure

```json
{
  "success": true,
  "data": {},
  "message": "Optional success message"
}
```

### Sorting and Filtering

Most list endpoints support filtering via query parameters where documented. Sorting is generally handled server-side by the SQL queries (e.g., by date, name, or creation time).

---

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **All endpoints:** 100 requests per 15 minutes per IP

When rate limit is exceeded:

**Response:** `429 Too Many Requests`

```
Too many requests from this IP, please try again later.
```

---

## Security

### JWT Tokens

- Tokens expire after **7 days**
- Token payload includes: `userId`, `email`, `role`
- Use the `/api/auth/refresh` endpoint to extend sessions
- Store tokens securely (HttpOnly cookies or secure storage)
- Never expose tokens in URLs

### Password Security

- Passwords are hashed using **bcrypt** before storage
- The `password_hash` field is never returned in API responses

### CORS

In development, all `localhost` origins are allowed. In production, configure `CORS_ORIGIN` environment variable.

### Input Validation

All input is validated on the server side. Client-side validation is supplementary.

### SQL Injection Prevention

All database queries use parameterized statements.

---

## Database Schema Reference

### Core Tables

| Table | Description |
|-------|-------------|
| `users` | User accounts with authentication and role data |
| `departments` | Organizational departments |
| `user_departments` | Many-to-many relationship between users and departments |
| `skills` | Available skills/competencies |
| `user_skills` | Many-to-many relationship between users and skills (with proficiency level) |
| `shift_templates` | Reusable shift definitions |
| `shift_template_skills` | Required skills for shift templates |
| `schedules` | Schedule containers/periods |
| `shifts` | Individual shift instances |
| `shift_skills` | Required skills for specific shifts |
| `shift_assignments` | Employee assignments to shifts |
| `user_unavailability` | Date ranges when employees cannot work |
| `user_preferences` | Employee scheduling preferences |
| `system_settings` | Application-wide configuration |
| `audit_logs` | System activity tracking |

---

<div align="center">

**Staff Scheduler API** - Version 1.0.0

Developed by Luca Ostinelli

*Last Updated: March 2026*

</div>
