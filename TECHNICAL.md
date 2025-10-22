# TECHNICAL REFERENCE - Staff Scheduler# Staff Scheduler - Complete Technical Documentation



> **Complete technical specification for Staff Scheduler platform. This document contains API documentation, database schema, optimization algorithms, deployment procedures, and system architecture details.**> **Enterprise-Grade Workforce Management System**  

> Advanced scheduling optimization with constraint programming and hierarchical organization support

**Table of Contents:**

1. [API Reference](#api-reference)---

2. [Database Schema](#database-schema)

3. [Authentication & Authorization](#authentication--authorization)## Table of Contents

4. [Optimization Engine](#optimization-engine)

5. [System Architecture](#system-architecture)1. [System Overview](#system-overview)

6. [Performance & Scalability](#performance--scalability)2. [Architecture & Technology Stack](#architecture--technology-stack)

7. [Configuration Reference](#configuration-reference)3. [Installation & Setup](#installation--setup)

8. [Deployment Guide](#deployment-guide)4. [Database Schema](#database-schema)

9. [Maintenance & Monitoring](#maintenance--monitoring)5. [Backend API Documentation](#backend-api-documentation)

10. [Troubleshooting](#troubleshooting)6. [Frontend Application](#frontend-application)

7. [Optimization Engine](#optimization-engine)

---8. [Security & Authentication](#security--authentication)

9. [Configuration Management](#configuration-management)

## API REFERENCE10. [Development Workflow](#development-workflow)

11. [Production Deployment](#production-deployment)

### Base URL12. [Performance & Scaling](#performance--scaling)

```13. [Troubleshooting & Maintenance](#troubleshooting--maintenance)

http://localhost:3001/api

```---



### Authentication## System Overview

All endpoints except `/auth/login` require JWT token:

```Staff Scheduler is a comprehensive workforce management platform designed for enterprise environments that require sophisticated scheduling optimization, multi-level organizational hierarchies, and complex constraint management.

Authorization: Bearer {jwt_token}

```### Core Features



### Response Format (Standard)**🎯 Advanced Scheduling Optimization**

```json- Constraint programming algorithms for optimal assignments

{- Multi-objective optimization (cost, coverage, fairness, preferences)

  "success": true,- Real-time conflict detection and resolution

  "data": {},- Support for forced assignments and exceptions

  "message": "Optional message",

  "timestamp": "2025-10-22T15:30:45.123Z"**👥 Hierarchical Organization Management**

}- N-level supervisor hierarchies with delegation support

```- Role-based access control with inherited permissions

- Matrix organization support for complex structures

### Error Format- Automated authority delegation and approval workflows

```json

{**📊 Enterprise Analytics & Reporting**

  "success": false,- Real-time dashboard with KPIs and metrics

  "error": {- Department-specific performance analytics

    "code": "SCHEDULE_NOT_FOUND",- Cost analysis and budget optimization

    "message": "Schedule with ID 123 not found",- Compliance reporting and audit trails

    "details": {}

  },**🔧 Production-Ready Infrastructure**

  "timestamp": "2025-10-22T15:30:45.123Z"- Docker containerization with health checks

}- Horizontal scaling support

```- Comprehensive logging and monitoring

- Automated backup and disaster recovery

---

### Business Use Cases

## SCHEDULES ENDPOINTS

- **Healthcare Facilities**: 24/7 nursing schedules, doctor rotations, compliance requirements

### POST /api/schedules- **Manufacturing**: Shift coverage, skills-based assignments, union regulations

**Create new schedule**- **Retail Operations**: Peak hour optimization, part-time scheduling, seasonal adjustments

- **Service Industries**: Customer service coverage, on-call management, cross-training

**Request:**

```json---

{

  "name": "October 2025 - Department A",## Architecture & Technology Stack

  "department_id": 1,

  "start_date": "2025-10-01",### System Architecture

  "end_date": "2025-10-31",

  "description": "Monthly schedule for operations team"```mermaid

}graph TB

```    subgraph "Frontend Layer"

        UI[React TypeScript SPA]

**Response (201 Created):**        PWA[Progressive Web App]

```json    end

{    

  "success": true,    subgraph "API Gateway"

  "data": {        NGINX[Nginx Reverse Proxy]

    "id": 456,        RATE[Rate Limiting]

    "name": "October 2025 - Department A",        SSL[SSL Termination]

    "department_id": 1,    end

    "status": "draft",    

    "coverage_percentage": 0,    subgraph "Application Layer"

    "start_date": "2025-10-01",        API[Express.js REST API]

    "end_date": "2025-10-31",        AUTH[JWT Authentication]

    "created_by": 789,        RBAC[Role-Based Access Control]

    "created_at": "2025-10-22T15:30:45.123Z"    end

  }    

}    subgraph "Business Logic"

```        SCHED[Schedule Optimizer]

        RULES[Constraint Engine]

**Error Codes:**        NOTIFY[Notification Service]

- `400` - Invalid input (missing required fields)    end

- `401` - Unauthorized    

- `403` - Insufficient permissions    subgraph "Data Layer"

- `409` - Overlapping schedules exist        DB[(MySQL 8.0)]

        REDIS[(Redis Cache)]

---        FILES[File Storage]

    end

### GET /api/schedules    

**List all schedules with filtering**    subgraph "External Integrations"

        HR[HR Systems]

**Query Parameters:**        PAYROLL[Payroll Systems]

```        EMAIL[Email Gateway]

department_id=1          (optional) - Filter by department    end

status=draft|published   (optional) - Filter by status    

start_date=2025-10-01    (optional) - Filter by start date    UI --> NGINX

end_date=2025-10-31      (optional) - Filter by end date    PWA --> NGINX

sort_by=created_at       (optional) - Sort field    NGINX --> API

sort_order=asc|desc      (optional) - Sort direction (default: desc)    API --> SCHED

page=1                   (optional) - Page number (default: 1)    API --> DB

limit=20                 (optional) - Records per page (default: 20)    API --> REDIS

```    SCHED --> RULES

    API --> HR

**Response (200 OK):**    API --> PAYROLL

```json    NOTIFY --> EMAIL

{```

  "success": true,

  "data": [### Technology Stack

    {

      "id": 456,**Frontend**

      "name": "October 2025 - Department A",- **React 18.2**: Modern UI framework with hooks and context

      "department_id": 1,- **TypeScript 5.1**: Type-safe development with advanced features

      "status": "published",- **Bootstrap 5.3**: Responsive design and component library

      "coverage_percentage": 94.5,- **Axios**: HTTP client with interceptors and error handling

      "start_date": "2025-10-01",

      "end_date": "2025-10-31",**Backend**

      "created_at": "2025-10-22T15:30:45.123Z",- **Node.js 18+**: LTS runtime with ES2022 support

      "updated_at": "2025-10-23T10:15:30.456Z"- **Express.js 4.18**: Web framework with middleware ecosystem

    }- **TypeScript 5.1**: Server-side type safety

  ],- **MySQL 8.0**: ACID-compliant relational database

  "pagination": {

    "page": 1,**Infrastructure**

    "limit": 20,- **Docker & Docker Compose**: Containerization and orchestration

    "total": 1,- **Nginx**: Reverse proxy and static file serving

    "pages": 1- **Redis**: Session storage and caching (optional)

  }- **PHPMyAdmin**: Database administration interface

}

```**Development Tools**

- **Jest**: Unit and integration testing

---- **ESLint & Prettier**: Code quality and formatting

- **GitHub Actions**: CI/CD pipelines

### GET /api/schedules/:id- **Swagger/OpenAPI**: API documentation

**Get schedule details with assignments**

---

**Response (200 OK):**

```json## Installation & Setup

{

  "success": true,### Prerequisites

  "data": {

    "id": 456,- **Docker Desktop 4.0+** with Docker Compose V2

    "name": "October 2025 - Department A",- **Git** for version control

    "department_id": 1,- **Node.js 18+** (for local development only)

    "status": "published",- **8GB RAM minimum** for full stack deployment

    "coverage_percentage": 94.5,

    "fairness_score": 0.87,### Quick Start (Production)

    "total_assignments": 450,

    "start_date": "2025-10-01",1. **Clone the repository**

    "end_date": "2025-10-31",   ```bash

    "created_by": 789,   git clone https://github.com/yourorganization/StaffScheduler.git

    "created_at": "2025-10-22T15:30:45.123Z",   cd StaffScheduler

    "assignments": [   ```

      {

        "id": 1001,2. **Configure environment**

        "employee_id": 100,   ```bash

        "shift_id": 50,   cp .env.example .env

        "date": "2025-10-01",   # Edit .env with your production values

        "start_time": "08:00",   nano .env

        "end_time": "16:00",   ```

        "notes": "Regular shift"

      }3. **Deploy the complete stack**

    ]   ```bash

  }   docker-compose up -d

}   ```

```

4. **Verify deployment**

---   ```bash

   docker-compose ps

### PUT /api/schedules/:id   curl http://localhost:3001/api/health

**Update schedule (draft only)**   ```



**Request:**### Development Setup

```json

{1. **Install dependencies**

  "name": "Updated name",   ```bash

  "description": "Updated description"   # Backend dependencies

}   cd backend && npm install

```   

   # Frontend dependencies  

**Allowed fields:** `name`, `description` (only in draft status)   cd ../frontend && npm install

   ```

**Response (200 OK):** Updated schedule object

2. **Start development services**

**Error Codes:**   ```bash

- `400` - Cannot update published schedule   # Start database only

- `404` - Schedule not found   docker-compose up -d mysql

- `409` - Name already exists   

   # Start backend in development mode

---   cd backend && npm run dev

   

### DELETE /api/schedules/:id   # Start frontend in development mode

**Delete schedule (draft only)**   cd frontend && npm start

   ```

**Response (204 No Content)**

### Environment Configuration

**Error Codes:**

- `400` - Cannot delete published scheduleThe `.env.example` file provides a complete template for all configuration options:

- `404` - Schedule not found

- `409` - Schedule has dependent records```bash

# Database Configuration

---MYSQL_ROOT_PASSWORD=your-secure-root-password

MYSQL_DATABASE=staff_scheduler

### POST /api/schedules/:id/generateMYSQL_USER=scheduler_user

**Generate optimized schedule using constraint programming**MYSQL_PASSWORD=your-secure-password



**Request:**# Authentication & Security

```jsonJWT_SECRET=your-256-bit-secret-key

{SESSION_SECRET=your-session-secret

  "algorithm": "hybrid",BCRYPT_SALT_ROUNDS=12

  "max_iterations": 10000,

  "timeout_seconds": 300,# Application Ports

  "include_constraints": {BACKEND_PORT=3001

    "hard": ["coverage", "availability", "skills"],FRONTEND_PORT=3000

    "soft": ["fairness", "preferences", "consecutive_days"]PHPMYADMIN_PORT=8080

  }

}# External Services (Optional)

```REDIS_HOST=localhost

REDIS_PORT=6379

**Response (200 OK):**EMAIL_SMTP_HOST=smtp.yourprovider.com

```json

{# Development Settings

  "success": true,NODE_ENV=production

  "data": {DEBUG=false

    "schedule_id": 456,LOG_LEVEL=info

    "total_assignments": 450,```

    "coverage_percentage": 96.3,

    "fairness_score": 0.89,### Demo Accounts & Initial Data

    "optimization_metrics": {

      "iterations_completed": 8547,The system automatically provisions demo accounts for immediate testing and evaluation:

      "runtime_ms": 2543,

      "initial_cost": 285.5,#### Pre-configured User Accounts

      "final_cost": 42.3,

      "improvement_percentage": 85.2| Role | Email | Password | Employee ID | Access Level |

    },|------|-------|----------|-------------|--------------|

    "constraint_violations": {| **Administrator** | `admin@staffscheduler.com` | `Admin123!` | `ADMIN001` | Full system access, user management, global settings |

      "hard_violations": 0,| **Manager** | `manager@staffscheduler.com` | `Manager123!` | `MGR001` | Department management, schedule creation, team oversight |

      "soft_violations": 8,| **Employee** | `employee@staffscheduler.com` | `Employee123!` | `EMP001` | View schedules, manage availability, submit requests |

      "total_penalty": 42.3

    },#### Frontend Integration

    "assignments_created": 450,

    "message": "Schedule generated successfully with near-optimal coverage"The login interface provides convenient demo buttons that automatically populate credentials:

  }

}```tsx

```// Demo credential buttons in Login.tsx

<button onClick={() => fillDemoCredentials('admin@staffscheduler.com', 'Admin123!')}>

**Error Codes:**  Admin Demo

- `400` - Invalid parameters</button>

- `404` - Schedule not found```

- `409` - Schedule not in draft status

- `422` - Cannot generate schedule (insufficient data)#### Security Considerations

- `504` - Generation timeout

⚠️ **Production Warning**: These demo accounts are created with default passwords and should be:

---1. **Removed** or **disabled** in production environments

2. **Password changed** if kept for training purposes

### PATCH /api/schedules/:id/publish3. **Monitored** in audit logs if used in staging environments

**Publish schedule (makes read-only)**

#### Database Initialization

**Request:** (optional)

```jsonDemo accounts are created during database initialization via `init.sql`:

{

  "notify_employees": true,```sql

  "send_email": true-- Demo accounts with bcrypt-hashed passwords

}INSERT INTO users (email, password_hash, first_name, last_name, role, employee_id, is_active) VALUES

```('admin@staffscheduler.com', '$2b$12$bEa8bPAzR10Y0UfIEhgWaexky8xMgFPAHI.aezL8QFANYI3Gduvqe', 'System', 'Administrator', 'admin', 'ADMIN001', TRUE),

('manager@staffscheduler.com', '$2b$12$5iIH6jkM.dqcxoNzJy8qX./ngaz36DKNowyj1ATOCITkth9wyxWKe', 'Demo', 'Manager', 'manager', 'MGR001', TRUE),

**Response (200 OK):**('employee@staffscheduler.com', '$2b$12$ughXosj1EZD/KNbISNgSze.EHdZlTO/UYhH.1H0Z90aqJo.T9NKOG', 'Demo', 'Employee', 'employee', 'EMP001', TRUE);

```json```

{

  "success": true,---

  "data": {

    "id": 456,## Database Schema

    "status": "published",

    "published_at": "2025-10-24T12:30:00.000Z",### Core Tables

    "published_by": 789

  }**users**: Authentication and hierarchy management

}```sql

```CREATE TABLE users (

  id VARCHAR(36) PRIMARY KEY,

---  email VARCHAR(255) UNIQUE NOT NULL,

  password_hash VARCHAR(255) NOT NULL,

### PATCH /api/schedules/:id/archive  role ENUM('master', 'supervisor', 'employee') NOT NULL,

**Archive schedule (soft delete)**  parent_supervisor VARCHAR(36),

  hierarchy_level INT DEFAULT 0,

**Response (200 OK):**  hierarchy_path VARCHAR(500), -- Materialized path: "0.1.3.7"

```json  max_subordinate_level INT,

{  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  "success": true,  is_active BOOLEAN DEFAULT TRUE

  "data": {);

    "id": 456,```

    "status": "archived",

    "archived_at": "2025-10-24T12:30:00.000Z"**employees**: Employee profiles and organizational data

  }```sql

}CREATE TABLE employees (

```  id VARCHAR(36) PRIMARY KEY,

  employee_id VARCHAR(50) UNIQUE NOT NULL,

---  user_id VARCHAR(36),

  first_name VARCHAR(100) NOT NULL,

## EMPLOYEES ENDPOINTS  last_name VARCHAR(100) NOT NULL,

  email VARCHAR(255) UNIQUE NOT NULL,

### GET /api/employees  phone VARCHAR(20),

**List employees with filtering**  department VARCHAR(100) NOT NULL,

  position VARCHAR(100) NOT NULL,

**Query Parameters:**  employment_type ENUM('full_time', 'part_time', 'contract', 'temporary'),

```  hire_date DATE,

department_id=1          (optional)  hourly_rate DECIMAL(10,2),

status=active|inactive   (optional)  is_active BOOLEAN DEFAULT TRUE

skill=skill_id           (optional));

page=1                   (optional)```

limit=50                 (optional)

```**shifts**: Shift definitions and requirements

```sql

**Response:**CREATE TABLE shifts (

```json  id VARCHAR(36) PRIMARY KEY,

{  name VARCHAR(255) NOT NULL,

  "success": true,  department VARCHAR(100) NOT NULL,

  "data": [  date DATE NOT NULL,

    {  start_time TIME NOT NULL,

      "id": 100,  end_time TIME NOT NULL,

      "first_name": "John",  minimum_staff INT DEFAULT 1,

      "last_name": "Doe",  maximum_staff INT,

      "email": "john.doe@example.com",  required_skills JSON,

      "employee_id": "EMP001",  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',

      "department_id": 1,  created_by VARCHAR(36),

      "status": "active",  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

      "hire_date": "2020-01-15",);

      "hourly_rate": 25.50,```

      "skills": [

        { "id": 1, "name": "Nursing", "level": 5 }**assignments**: Employee-shift assignments with approval workflow

      ],```sql

      "availability": {CREATE TABLE assignments (

        "monday": true,  id VARCHAR(36) PRIMARY KEY,

        "tuesday": true,  employee_id VARCHAR(36) NOT NULL,

        "wednesday": true,  shift_id VARCHAR(36) NOT NULL,

        "thursday": true,  assigned_role VARCHAR(100),

        "friday": true,  status ENUM('pending', 'approved', 'rejected', 'completed') DEFAULT 'pending',

        "saturday": false,  approved_by VARCHAR(36),

        "sunday": false  approved_at TIMESTAMP NULL,

      }  notes TEXT,

    }  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  ],  UNIQUE KEY unique_assignment (employee_id, shift_id)

  "pagination": { "page": 1, "limit": 50, "total": 156 });

}```

```

### Advanced Features Tables

---

**employee_preferences**: Work preferences and constraints

### POST /api/employees```sql

**Create employee**CREATE TABLE employee_preferences (

  id VARCHAR(36) PRIMARY KEY,

**Request:**  employee_id VARCHAR(36) NOT NULL,

```json  preference_type ENUM('preferred_shifts', 'avoided_shifts', 'max_hours', 'consecutive_days'),

{  value JSON NOT NULL,

  "first_name": "Jane",  priority INT DEFAULT 1,

  "last_name": "Smith",  effective_from DATE,

  "email": "jane.smith@example.com",  effective_until DATE

  "employee_id": "EMP002",);

  "department_id": 1,```

  "hire_date": "2025-10-01",

  "hourly_rate": 28.75,**schedules**: Generated schedule metadata

  "skills": [1, 2, 5],```sql

  "availability": {CREATE TABLE schedules (

    "monday": true,  id VARCHAR(36) PRIMARY KEY,

    "tuesday": true,  name VARCHAR(255) NOT NULL,

    "wednesday": true,  department VARCHAR(100),

    "thursday": true,  start_date DATE NOT NULL,

    "friday": true,  end_date DATE NOT NULL,

    "saturday": false,  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',

    "sunday": false  optimization_score DECIMAL(5,2),

  }  created_by VARCHAR(36),

}  published_at TIMESTAMP NULL

```);

```

**Response (201 Created):** Employee object

**constraint_violations**: Tracking and resolution

---```sql

CREATE TABLE constraint_violations (

### GET/PUT/DELETE /api/employees/:id  id VARCHAR(36) PRIMARY KEY,

**Get, update, or delete employee**  assignment_id VARCHAR(36),

  violation_type VARCHAR(100) NOT NULL,

**PUT Request:**  severity ENUM('low', 'medium', 'high', 'critical'),

```json  description TEXT,

{  resolved BOOLEAN DEFAULT FALSE,

  "hourly_rate": 30.00,  resolution_notes TEXT

  "status": "inactive",);

  "skills": [1, 2, 3]```

}

```### Database Views



---**employee_availability**: Real-time availability status

```sql

## SHIFTS ENDPOINTSCREATE VIEW employee_availability AS

SELECT 

### GET /api/shifts  e.id,

**List shift templates**  e.employee_id,

  e.first_name,

**Query Parameters:**  e.last_name,

```  e.department,

department_id=1          (optional)  COUNT(a.id) as active_assignments,

shift_type=day|night     (optional)  SUM(TIMESTAMPDIFF(HOUR, s.start_time, s.end_time)) as weekly_hours

status=active            (optional)FROM employees e

page=1                   (optional)LEFT JOIN assignments a ON e.id = a.employee_id AND a.status = 'approved'

limit=20                 (optional)LEFT JOIN shifts s ON a.shift_id = s.id AND s.date >= CURDATE()

```WHERE e.is_active = TRUE

GROUP BY e.id;

**Response:**```

```json

{---

  "success": true,

  "data": [## Backend API Documentation

    {

      "id": 50,### Authentication Endpoints

      "name": "Day Shift",

      "shift_type": "day",**POST /api/auth/login**

      "start_time": "08:00",```typescript

      "end_time": "16:00",// Request

      "duration_hours": 8,{

      "required_staff": 5,  email: string;

      "required_skills": [1, 2],  password: string;

      "department_id": 1,  rememberMe?: boolean;

      "priority": "high",}

      "status": "active"

    }// Response

  ]{

}  success: true,

```  data: {

    token: string;

---    user: {

      id: string;

### POST /api/shifts      email: string;

**Create shift template**      role: 'master' | 'supervisor' | 'employee';

      hierarchyLevel: number;

**Request:**      permissions: string[];

```json    }

{  }

  "name": "Evening Shift",}

  "shift_type": "evening",```

  "start_time": "16:00",

  "end_time": "24:00",**GET /api/auth/verify**

  "duration_hours": 8,- Validates JWT token and returns user information

  "required_staff": 4,- Headers: `Authorization: Bearer <token>`

  "required_skills": [1],

  "department_id": 1,### Employee Management

  "priority": "medium"

}**GET /api/employees**

``````typescript

// Query Parameters

---{

  page?: number;

## DEPARTMENTS ENDPOINTS  limit?: number;

  department?: string;

### GET /api/departments  position?: string;

**List departments (hierarchical)**  search?: string;

  sortBy?: 'firstName' | 'lastName' | 'department';

**Response:**  sortOrder?: 'asc' | 'desc';

```json}

{

  "success": true,// Response

  "data": [{

    {  success: true,

      "id": 1,  data: Employee[],

      "name": "Operations",  meta: {

      "code": "OPS",    total: number;

      "parent_id": null,    page: number;

      "manager_id": 789,    limit: number;

      "level": 0,    totalPages: number;

      "employee_count": 156,  }

      "budget_annual": 500000,}

      "created_at": "2020-01-01T00:00:00.000Z",```

      "children": [

        {**POST /api/employees**

          "id": 2,```typescript

          "name": "Night Operations",// Request

          "parent_id": 1,{

          "level": 1,  employeeId: string;

          "employee_count": 45  firstName: string;

        }  lastName: string;

      ]  email: string;

    }  phone?: string;

  ]  department: string;

}  position: string;

```  employmentType: 'full_time' | 'part_time' | 'contract' | 'temporary';

  hireDate: string; // ISO date

---  hourlyRate?: number;

}

### POST /api/departments

**Create department**// Response

{

**Request:**  success: true,

```json  data: Employee

{}

  "name": "Night Operations",```

  "code": "NIGHT_OPS",

  "parent_id": 1,**GET /api/employees/:id**

  "manager_id": 790,- Returns detailed employee information including preferences and assignments

  "budget_annual": 150000

}**PUT /api/employees/:id**

```- Updates employee information with partial data support



---**DELETE /api/employees/:id**

- Soft delete with data retention for audit purposes

## USERS ENDPOINTS

### Shift Management

### POST /api/auth/login

**Authenticate user****GET /api/shifts**

```typescript

**Request:**// Query Parameters

```json{

{  department?: string;

  "email": "admin@example.com",  status?: 'draft' | 'published' | 'archived';

  "password": "secure_password"  startDate?: string; // ISO date

}  endDate?: string; // ISO date

```  page?: number;

  limit?: number;

**Response (200 OK):**}

```json```

{

  "success": true,**POST /api/shifts**

  "data": {```typescript

    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",// Request

    "user": {{

      "id": 789,  name: string;

      "email": "admin@example.com",  department: string;

      "first_name": "Admin",  date: string; // ISO date

      "last_name": "User",  startTime: string; // HH:MM format

      "role": "admin",  endTime: string; // HH:MM format

      "department_id": 1  minimumStaff: number;

    }  maximumStaff?: number;

  }  requiredSkills?: string[];

}}

``````



**Error Codes:**### Assignment Management

- `401` - Invalid credentials

- `429` - Too many login attempts**GET /api/assignments**

```typescript

---// Query Parameters

{

### POST /api/auth/logout  employeeId?: string;

**Revoke JWT token**  shiftId?: string;

  status?: 'pending' | 'approved' | 'rejected' | 'completed';

**Response (200 OK)**  startDate?: string;

  endDate?: string;

---}

```

### GET /api/users

**List users with filtering****POST /api/assignments**

```typescript

**Query Parameters:**// Request

```{

role=admin|manager|department_manager|employee  employeeId: string;

department_id=1  shiftId: string;

status=active|inactive  assignedRole?: string;

```  notes?: string;

}

---```



### POST /api/users**PUT /api/assignments/:id/approve**

**Create user**- Approves pending assignment with authorization checks



**Request:****PUT /api/assignments/:id/reject**

```json```typescript

{// Request

  "email": "user@example.com",{

  "password": "secure_password_min_8_chars",  reason: string;

  "first_name": "User",  notes?: string;

  "last_name": "Name",}

  "role": "manager",```

  "department_id": 1

}### Schedule Optimization

```

**POST /api/schedules/generate**

---```typescript

// Request

### GET/PUT/DELETE /api/users/:id{

**Get, update, or delete user**  name: string;

  department?: string;

---  startDate: string;

  endDate: string;

## DASHBOARD ENDPOINTS  constraints: {

    maxConsecutiveDays?: number;

### GET /api/dashboard/stats    minRestHours?: number;

**Get key performance indicators**    respectPreferences?: boolean;

    allowOvertime?: boolean;

**Response:**  };

```json  weights: {

{    coverage: number;

  "success": true,    fairness: number;

  "data": {    preferences: number;

    "total_employees": 156,    stability: number;

    "total_schedules": 12,  };

    "active_schedules": 3,}

    "average_coverage": 94.2,

    "total_labor_cost": 45250,// Response

    "top_departments": [{

      {  success: true,

        "id": 1,  data: {

        "name": "Operations",    scheduleId: string;

        "employee_count": 78,    assignments: Assignment[];

        "coverage": 95.5    optimizationScore: number;

      }    violations: ConstraintViolation[];

    ]    metrics: {

  }      coverageRate: number;

}      totalCost: number;

```      employeeSatisfaction: number;

    }

---  }

}

### GET /api/dashboard/activity```

**Get recent system activity**

### Dashboard Analytics

**Response:**

```json**GET /api/dashboard/stats**

{```typescript

  "success": true,// Response

  "data": [{

    {  success: true,

      "id": 1,  data: {

      "action": "schedule_generated",    totalEmployees: number;

      "schedule_id": 456,    activeSchedules: number;

      "user_id": 789,    todayShifts: number;

      "timestamp": "2025-10-24T12:30:00.000Z",    pendingApprovals: number;

      "details": "Generated schedule with 450 assignments"    monthlyHours: number;

    }    monthlyCost: number;

  ]    coverageRate: number;

}    employeeSatisfaction: number;

```  }

}

---```



### GET /api/dashboard/upcoming-shifts**GET /api/dashboard/activities**

**Get shifts for next 7 days**- Returns recent system activities with user attribution



**Response:****GET /api/dashboard/upcoming-shifts**

```json- Shows shifts requiring immediate attention

{

  "success": true,**GET /api/dashboard/departments**

  "data": [- Department-specific statistics and metrics

    {

      "date": "2025-10-25",### Error Handling

      "total_shifts": 15,

      "assigned_positions": 14,All API endpoints return standardized error responses:

      "coverage_percentage": 93.3,

      "shifts": [...]```typescript

    }{

  ]  success: false,

}  error: {

```    code: string;

    message: string;

---    details?: any;

  }

## HEALTH CHECK ENDPOINTS}

```

### GET /api/health

**System health status**Common error codes:

- `VALIDATION_ERROR`: Input validation failed

**Response (200 OK):**- `NOT_FOUND`: Resource not found

```json- `UNAUTHORIZED`: Authentication required

{- `FORBIDDEN`: Insufficient permissions

  "success": true,- `CONFLICT`: Resource conflict (e.g., duplicate employee ID)

  "status": "healthy",- `INTERNAL_ERROR`: Server error

  "uptime_seconds": 3600,

  "version": "1.0.0"---

}

```## Frontend Application



---### Component Architecture



### GET /api/health/database```

**Database connectivity**src/

├── components/

**Response (200 OK):**│   ├── Layout/

```json│   │   ├── Header.tsx          # Navigation and user menu

{│   │   ├── Sidebar.tsx         # Main navigation menu

  "success": true,│   │   └── Layout.tsx          # Main layout wrapper

  "database": "connected",│   ├── Auth/

  "response_time_ms": 2,│   │   └── ProtectedRoute.tsx  # Route authentication guard

  "tables": 15│   └── Common/                 # Reusable UI components

}├── pages/

```│   ├── Dashboard/

│   │   └── Dashboard.tsx       # Main dashboard with KPIs

---│   ├── Employees/

│   │   └── Employees.tsx       # Employee management interface

### GET /api/health/memory│   ├── Shifts/

**Memory usage**│   │   └── Shifts.tsx          # Shift creation and management

│   ├── Schedule/

**Response (200 OK):**│   │   └── Schedule.tsx        # Schedule optimization interface

```json│   ├── Reports/

{│   │   └── Reports.tsx         # Analytics and reporting

  "success": true,│   ├── Settings/

  "memory_used_mb": 256,│   │   └── Settings.tsx        # System configuration

  "memory_limit_mb": 512,│   └── Auth/

  "usage_percentage": 50│       └── Login.tsx           # Authentication interface

}├── services/

```│   ├── authService.ts          # Authentication API calls

│   ├── employeeService.ts      # Employee management API

---│   ├── shiftService.ts         # Shift management API

│   └── dashboardService.ts     # Dashboard data API

## DATABASE SCHEMA├── contexts/

│   └── AuthContext.tsx         # Global authentication state

### Core Tables├── types/

│   └── index.ts                # TypeScript type definitions

#### users└── utils/

```sql    └── index.ts                # Utility functions

CREATE TABLE users (```

  id INT PRIMARY KEY AUTO_INCREMENT,

  email VARCHAR(255) UNIQUE NOT NULL,### Key Features

  password_hash VARCHAR(255) NOT NULL,

  first_name VARCHAR(100) NOT NULL,**🔐 Authentication & Authorization**

  last_name VARCHAR(100) NOT NULL,- JWT-based authentication with automatic token refresh

  role ENUM('admin', 'manager', 'department_manager', 'employee') NOT NULL,- Role-based UI components with permission checks

  department_id INT,- Secure route protection with redirect handling

  status ENUM('active', 'inactive') DEFAULT 'active',

  last_login TIMESTAMP,**📱 Responsive Design**

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,- Mobile-first approach with Bootstrap integration

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,- Progressive Web App capabilities

  FOREIGN KEY (department_id) REFERENCES departments(id),- Touch-friendly interface for mobile devices

  INDEX idx_email (email),

  INDEX idx_role (role),**⚡ Performance Optimization**

  INDEX idx_department_id (department_id)- React.memo for component optimization

);- Lazy loading for route-based code splitting

```- Efficient state management with Context API



#### departments**🎯 User Experience**

```sql- Real-time form validation with error handling

CREATE TABLE departments (- Loading states and progress indicators

  id INT PRIMARY KEY AUTO_INCREMENT,- Comprehensive error boundaries

  name VARCHAR(255) NOT NULL,

  code VARCHAR(50) UNIQUE NOT NULL,### Type Definitions

  parent_id INT,

  manager_id INT,Complete TypeScript interfaces for all data models:

  budget_annual DECIMAL(10, 2),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,```typescript

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,// User and Authentication

  FOREIGN KEY (parent_id) REFERENCES departments(id),export interface User {

  FOREIGN KEY (manager_id) REFERENCES users(id),  id: string;

  INDEX idx_parent_id (parent_id),  email: string;

  INDEX idx_code (code)  role: 'master' | 'supervisor' | 'employee';

);  employee_id?: string;

```  parent_supervisor?: string;

  hierarchy_level: number;

#### employees  hierarchy_path: string;

```sql  max_subordinate_level?: number;

CREATE TABLE employees (  permissions: Permission[];

  id INT PRIMARY KEY AUTO_INCREMENT,  delegated_authorities: DelegatedAuthority[];

  user_id INT,  created_at: string;

  employee_id VARCHAR(50) UNIQUE NOT NULL,  last_login?: string;

  first_name VARCHAR(100) NOT NULL,  is_active: boolean;

  last_name VARCHAR(100) NOT NULL,}

  email VARCHAR(255),

  department_id INT NOT NULL,// Employee Management

  hire_date DATE NOT NULL,export interface Employee {

  hourly_rate DECIMAL(8, 2) NOT NULL,  id: string;

  status ENUM('active', 'inactive', 'on_leave') DEFAULT 'active',  employee_id: string;

  availability_json JSON,  user_id?: string;

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  first_name: string;

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  last_name: string;

  FOREIGN KEY (user_id) REFERENCES users(id),  email: string;

  FOREIGN KEY (department_id) REFERENCES departments(id),  phone?: string;

  INDEX idx_employee_id (employee_id),  department: string;

  INDEX idx_department_id (department_id),  position: string;

  INDEX idx_status (status)  employment_type: 'full_time' | 'part_time' | 'contract' | 'temporary';

);  hire_date?: string;

```  hourly_rate?: number;

  skills: string[];

#### shifts  certifications: string[];

```sql  work_patterns: WorkPattern[];

CREATE TABLE shifts (  preferences: EmployeePreferences;

  id INT PRIMARY KEY AUTO_INCREMENT,  emergency_contacts: EmergencyContact[];

  name VARCHAR(255) NOT NULL,  is_active: boolean;

  shift_type ENUM('day', 'evening', 'night', 'flexible') NOT NULL,  created_at: string;

  start_time TIME NOT NULL,  updated_at: string;

  end_time TIME NOT NULL,}

  duration_hours INT NOT NULL,

  required_staff INT NOT NULL,// Scheduling System

  department_id INT NOT NULL,export interface Shift {

  priority ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',  id: string;

  status ENUM('active', 'inactive') DEFAULT 'active',  name: string;

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  department: string;

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  date: string;

  FOREIGN KEY (department_id) REFERENCES departments(id),  start_time: string;

  INDEX idx_department_id (department_id),  end_time: string;

  INDEX idx_shift_type (shift_type)  minimum_staff: number;

);  maximum_staff?: number;

```  required_skills: string[];

  preferred_employees: string[];

#### schedules  break_duration?: number;

```sql  status: 'draft' | 'published' | 'archived';

CREATE TABLE schedules (  created_by: string;

  id INT PRIMARY KEY AUTO_INCREMENT,  created_at: string;

  name VARCHAR(255) NOT NULL,}

  department_id INT NOT NULL,```

  start_date DATE NOT NULL,

  end_date DATE NOT NULL,---

  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',

  coverage_percentage DECIMAL(5, 2),## Optimization Engine

  fairness_score DECIMAL(3, 2),

  created_by INT NOT NULL,### Algorithm Overview

  published_at TIMESTAMP NULL,

  archived_at TIMESTAMP NULL,The Schedule Optimizer uses constraint programming to solve complex scheduling problems with multiple objectives and constraints.

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,### Core Components

  FOREIGN KEY (department_id) REFERENCES departments(id),

  FOREIGN KEY (created_by) REFERENCES users(id),**Constraint Types**

  INDEX idx_department_id (department_id),

  INDEX idx_status (status),1. **Hard Constraints (Must be satisfied)**

  INDEX idx_dates (start_date, end_date)   - Employee availability windows

);   - Minimum rest periods between shifts

```   - Maximum consecutive working days

   - Skills and certification requirements

#### assignments   - Legal compliance (union rules, labor laws)

```sql

CREATE TABLE assignments (2. **Soft Constraints (Preferences to optimize)**

  id INT PRIMARY KEY AUTO_INCREMENT,   - Employee shift preferences

  schedule_id INT NOT NULL,   - Fair distribution of desirable/undesirable shifts

  employee_id INT NOT NULL,   - Minimization of total labor costs

  shift_id INT NOT NULL,   - Maximization of employee satisfaction

  assignment_date DATE NOT NULL,

  notes TEXT,### Optimization Process

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,```typescript

  FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,export class ScheduleOptimizer {

  FOREIGN KEY (employee_id) REFERENCES employees(id),  

  FOREIGN KEY (shift_id) REFERENCES shifts(id),  /**

  UNIQUE KEY unique_assignment (schedule_id, employee_id, shift_id, assignment_date),   * Generates optimal schedule using constraint programming

  INDEX idx_schedule_id (schedule_id),   */

  INDEX idx_employee_id (employee_id),  async optimize(problem: OptimizationProblem): Promise<OptimizationResult> {

  INDEX idx_assignment_date (assignment_date)    

);    // Phase 1: Constraint validation and preprocessing

```    const validatedProblem = await this.validateConstraints(problem);

    

#### skills    // Phase 2: Generate initial feasible solution

```sql    const initialSolution = await this.generateInitialSolution(validatedProblem);

CREATE TABLE skills (    

  id INT PRIMARY KEY AUTO_INCREMENT,    // Phase 3: Apply optimization algorithms

  name VARCHAR(100) NOT NULL,    const optimizedSolution = await this.applyOptimization(initialSolution);

  description TEXT,    

  category VARCHAR(50),    // Phase 4: Post-processing and validation

  status ENUM('active', 'inactive') DEFAULT 'active',    const finalSolution = await this.validateSolution(optimizedSolution);

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,    

  UNIQUE KEY unique_skill (name),    return finalSolution;

  INDEX idx_category (category)  }

);  

```  /**

   * Multi-objective optimization with weighted scoring

#### employee_skills   */

```sql  private calculateObjectiveScore(solution: Solution): number {

CREATE TABLE employee_skills (    const weights = solution.parameters.weights;

  id INT PRIMARY KEY AUTO_INCREMENT,    

  employee_id INT NOT NULL,    const coverageScore = this.calculateCoverageScore(solution);

  skill_id INT NOT NULL,    const fairnessScore = this.calculateFairnessScore(solution);

  proficiency_level INT DEFAULT 3,    const preferencesScore = this.calculatePreferencesScore(solution);

  verified BOOLEAN DEFAULT FALSE,    const costScore = this.calculateCostScore(solution);

  verified_date TIMESTAMP NULL,    

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,    return (

  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,      weights.coverage * coverageScore +

  FOREIGN KEY (skill_id) REFERENCES skills(id),      weights.fairness * fairnessScore +

  UNIQUE KEY unique_employee_skill (employee_id, skill_id),      weights.preferences * preferencesScore +

  INDEX idx_employee_id (employee_id),      weights.cost * costScore

  INDEX idx_skill_id (skill_id)    );

);  }

```}

```

#### shift_skills (required skills for shift)

```sql### Algorithm Strategies

CREATE TABLE shift_skills (

  id INT PRIMARY KEY AUTO_INCREMENT,**Greedy Assignment**

  shift_id INT NOT NULL,- Initial solution generation with constraint validation

  skill_id INT NOT NULL,- Prioritizes critical shifts and skilled employees

  required BOOLEAN DEFAULT TRUE,- Ensures basic feasibility before optimization

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,**Local Search**

  FOREIGN KEY (skill_id) REFERENCES skills(id),- Iterative improvement through assignment swaps

  UNIQUE KEY unique_shift_skill (shift_id, skill_id)- Hill-climbing with random restarts

);- Tabu search to avoid local optima

```

**Genetic Algorithm**

#### time_off_requests- Population-based optimization for complex problems

```sql- Crossover and mutation operators for schedule evolution

CREATE TABLE time_off_requests (- Elitism to preserve best solutions

  id INT PRIMARY KEY AUTO_INCREMENT,

  employee_id INT NOT NULL,### Performance Characteristics

  start_date DATE NOT NULL,

  end_date DATE NOT NULL,- **Small problems** (< 50 employees, < 200 shifts): < 1 second

  reason VARCHAR(255),- **Medium problems** (50-200 employees, 200-1000 shifts): 5-30 seconds

  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',- **Large problems** (200+ employees, 1000+ shifts): 1-10 minutes

  approved_by INT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,---

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id) REFERENCES employees(id),## Security & Authentication

  FOREIGN KEY (approved_by) REFERENCES users(id),

  INDEX idx_employee_id (employee_id),### Authentication System

  INDEX idx_status (status)

);**JWT (JSON Web Tokens)**

```- Stateless authentication with RSA-256 signing

- Configurable expiration times (default: 24 hours)

#### activity_log- Automatic token refresh for seamless user experience

```sql- Secure token storage with httpOnly cookies (optional)

CREATE TABLE activity_log (

  id INT PRIMARY KEY AUTO_INCREMENT,**Password Security**

  user_id INT NOT NULL,- bcrypt hashing with configurable salt rounds (default: 12)

  action VARCHAR(100) NOT NULL,- Password strength validation

  resource_type VARCHAR(50),- Secure password reset with time-limited tokens

  resource_id INT,- Account lockout after failed attempts

  details JSON,

  ip_address VARCHAR(45),### Authorization Model

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id),**Role-Based Access Control (RBAC)**

  INDEX idx_user_id (user_id),

  INDEX idx_action (action),1. **Master**: Full system access

  INDEX idx_created_at (created_at)   - User creation and management

);   - System configuration

```   - All employee and schedule operations



### Entity Relationship Diagram2. **Supervisor**: Departmental management

   - Employee management within assigned departments

```   - Schedule creation and approval

┌─────────────┐   - Subordinate user creation (limited levels)

│   users     │ (12 columns)

└─────────────┘3. **Employee**: Personal access

      │   - View assigned schedules

      ├─→ departments (manager_id)   - Submit time-off requests

      ├─→ schedules (created_by)   - Update personal preferences

      └─→ activity_log (user_id)

**Hierarchical Permissions**

┌─────────────┐- Automatic permission inheritance down the hierarchy

│ departments │ (8 columns) - Self-referencing (parent_id)- Delegation support for temporary authority transfer

└─────────────┘- Audit trail for all permission changes

      │

      ├─→ employees (department_id)### Security Headers

      ├─→ shifts (department_id)

      └─→ schedules (department_id)```typescript

// Helmet.js configuration

┌─────────────┐app.use(helmet({

│  employees  │ (13 columns)  contentSecurityPolicy: {

└─────────────┘    directives: {

      │      defaultSrc: ["'self'"],

      ├─→ employee_skills (employee_id)      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],

      ├─→ assignments (employee_id)      scriptSrc: ["'self'"],

      └─→ time_off_requests (employee_id)      imgSrc: ["'self'", "data:", "https:"],

    },

┌─────────────┐  },

│   shifts    │ (11 columns)  hsts: {

└─────────────┘    maxAge: 31536000,

      │    includeSubDomains: true,

      ├─→ shift_skills (shift_id)    preload: true

      └─→ assignments (shift_id)  }

}));

┌─────────────┐```

│  schedules  │ (11 columns)

└─────────────┘### Input Validation

      │

      └─→ assignments (schedule_id, CASCADE DELETE)**Request Validation**

- Joi schema validation for all API endpoints

┌─────────────┐- SQL injection prevention with parameterized queries

│   skills    │ (5 columns)- XSS protection with input sanitization

└─────────────┘- File upload validation with type and size limits

      │

      ├─→ employee_skills (skill_id)**Rate Limiting**

      └─→ shift_skills (skill_id)- Configurable rate limits per endpoint

```- IP-based and user-based limiting

- Progressive delays for repeated violations

---- Whitelist support for trusted sources



## AUTHENTICATION & AUTHORIZATION---



### JWT Token Structure## Configuration Management



**Header:**### Environment Variables

```json

{Complete configuration through environment variables with sensible defaults:

  "alg": "HS256",

  "typ": "JWT"```bash

}# === DATABASE CONFIGURATION ===

```DB_HOST=mysql

DB_PORT=3306

**Payload:**DB_NAME=staff_scheduler

```jsonDB_USER=scheduler_user

{DB_PASSWORD=your-secure-password

  "sub": 789,

  "email": "admin@example.com",# === AUTHENTICATION & SECURITY ===

  "role": "admin",JWT_SECRET=your-256-bit-secret-key

  "department_id": 1,JWT_EXPIRES_IN=24h

  "iat": 1698069045,SESSION_SECRET=your-session-secret

  "exp": 1698673845,BCRYPT_SALT_ROUNDS=12

  "iss": "staff-scheduler",

  "aud": "api.staff-scheduler"# === APPLICATION SETTINGS ===

}NODE_ENV=production

```PORT=3001

CORS_ORIGIN=http://localhost:3000

**Token Lifetime:** 7 days (configurable via JWT_EXPIRY)CORS_CREDENTIALS=true



### Role-Based Access Control (RBAC)# === RATE LIMITING ===

RATE_LIMIT_WINDOW=15

| Role | Permissions |RATE_LIMIT_MAX_REQUESTS=100

|------|-------------|

| **admin** | Full system access, user management, all schedules, all departments |# === LOGGING ===

| **manager** | Assigned department + subordinates, schedule management, employee management |LOG_LEVEL=info

| **department_manager** | Own department employees, shift creation, schedule viewing |LOG_FILE_ENABLED=true

| **employee** | Own schedule viewing, time-off requests, personal profile |LOG_FILE_PATH=/app/logs/app.log



### Permission Matrix# === OPTIMIZATION ENGINE ===

OPTIMIZATION_ENGINE=javascript

```OPTIMIZATION_TIMEOUT=300000

                    | admin | manager | dept_mgr | employeeMAX_CONCURRENT_OPTIMIZATIONS=2

────────────────────┼───────┼─────────┼──────────┼──────────

Create Schedule     │  ✓    │    ✓    │    ✓     │    ✗# === EXTERNAL SERVICES ===

Generate Schedule   │  ✓    │    ✓    │    ✓     │    ✗REDIS_HOST=localhost

Publish Schedule    │  ✓    │    ✓    │    ✗     │    ✗REDIS_PORT=6379

Create Shift        │  ✓    │    ✓    │    ✓     │    ✗REDIS_PASSWORD=

Manage Users        │  ✓    │    ✗    │    ✗     │    ✗

Manage Employees    │  ✓    │    ✓    │    ✓     │    ✗EMAIL_SMTP_HOST=smtp.yourprovider.com

View Department     │  ✓    │    ✓    │    ✓     │    ✓*EMAIL_SMTP_PORT=587

Create Department   │  ✓    │    ✗    │    ✗     │    ✗EMAIL_SMTP_USER=your-email@domain.com

View Analytics      │  ✓    │    ✓    │    ✓     │    ✗EMAIL_SMTP_PASSWORD=your-app-password

Request Time-Off    │  ✓    │    ✓    │    ✓     │    ✓

```# === BACKUP CONFIGURATION ===

BACKUP_ENABLED=true

*Employees view their assigned department onlyBACKUP_RETENTION_DAYS=30

BACKUP_S3_BUCKET=your-backup-bucket

### Password Policy

# === MONITORING ===

- Minimum 8 charactersPROMETHEUS_ENABLED=false

- Must contain uppercase, lowercase, number, special characterPROMETHEUS_PORT=9090

- No password reuse (last 5 passwords)HEALTH_CHECK_TIMEOUT=5000

- Automatic expiry: 90 days```

- Account lockout: 5 failed attempts for 15 minutes

### Docker Configuration

---

**Production Deployment**

## OPTIMIZATION ENGINE```yaml

# docker-compose.yml

### ScheduleOptimizer Classversion: '3.8'



**Location:** `backend/src/optimization/ScheduleOptimizer.ts` (655 lines)services:

  mysql:

**Purpose:** Solves multi-objective scheduling using hybrid constraint programming    image: mysql:8.0

    restart: unless-stopped

### Algorithm: Hybrid Greedy + Simulated Annealing    environment:

      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}

**Phase 1: Greedy Initialization**      MYSQL_DATABASE: ${MYSQL_DATABASE}

```      MYSQL_USER: ${MYSQL_USER}

Input:       MYSQL_PASSWORD: ${MYSQL_PASSWORD}

  - shifts: Shift[] (required staffing)    volumes:

  - employees: Employee[] (available staff)      - mysql_data:/var/lib/mysql

  - constraints: ConstraintSet      - ./backend/database/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  - skills: Skill[] (required vs available)      - ./mysql/conf.d:/etc/mysql/conf.d:ro

    ports:

Process:      - "${DB_PORT:-3306}:3306"

  1. Sort shifts by: priority DESC, coverage_gap DESC    healthcheck:

  2. For each shift:      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]

     a. Find qualified employees (skills match)      timeout: 20s

     b. Filter available (no conflicts, within availability)      retries: 10

     c. Filter not over-scheduled (workload limits)

     d. Rank by preference score and availability  backend:

     e. Assign top candidates    build:

  3. Return initial assignment with cost calculation      context: ./backend

      dockerfile: Dockerfile

Complexity: O(n·m·log k)      target: production

  n = employees, m = shifts, k = skills    restart: unless-stopped

    depends_on:

Time: 500ms - 2s (100 employees, 500 shifts)      mysql:

Result: Feasible solution with 85-90% coverage        condition: service_healthy

```    environment:

      NODE_ENV: production

**Phase 2: Simulated Annealing Optimization**      PORT: 3001

```      DB_HOST: mysql

Input: Initial assignment from Phase 1, constraint set      # ... other environment variables

    ports:

Configuration:      - "${BACKEND_PORT:-3001}:3001"

  Temperature = 100    volumes:

  Cooling Rate = 0.95      - backend_logs:/app/logs

  Max Iterations = 10,000      - backend_reports:/app/reports

  Timeout = 300 seconds    healthcheck:

      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3001/health"]

Loop:      interval: 30s

  1. Generate neighbor solution via random swap:      timeout: 10s

     - Pick random assignment A      retries: 3

     - Pick random employee E not in A's shift

     - If E qualifies and improves/acceptable → accept  frontend:

     - Else accept with probability e^(-cost_delta/T)    build:

        context: ./frontend

  2. Evaluate cost:      dockerfile: Dockerfile

     cost = Σ(hard_constraint_violations × weight)      target: production

          + Σ(soft_constraint_penalties × weight)    restart: unless-stopped

      depends_on:

  3. Update:      backend:

     - If cost < best_cost → update best solution        condition: service_healthy

     - Decrease temperature: T *= cooling_rate    ports:

        - "${FRONTEND_PORT:-3000}:3000"

  4. Termination:    healthcheck:

     - If iterations_completed ≥ max_iterations → stop      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]

     - If timeout reached → stop      interval: 30s

     - If T < 0.01 → stop (convergence)      timeout: 10s

      retries: 3

Complexity: O(I·n·m) = O(10000·100·500) = O(500M)

Time: 2-10 seconds average  phpmyadmin:

Result: Near-optimal solution with cost reduction 40-90%    image: phpmyadmin/phpmyadmin:latest

```    restart: unless-stopped

    depends_on:

### Constraint Definition      mysql:

        condition: service_healthy

**Hard Constraints (must satisfy):**    environment:

      PMA_HOST: mysql

```typescript      PMA_USER: ${MYSQL_USER}

interface HardConstraint {      PMA_PASSWORD: ${MYSQL_PASSWORD}

  name: string;    ports:

  weight: number; // Penalty multiplier (100-1000)      - "${PHPMYADMIN_PORT:-8080}:80"

  validate: (assignment: Assignment[], context: Context) => Violation[];

  penalty: (violation_count: number) => number;volumes:

}  mysql_data:

  backend_logs:

// Examples:  backend_reports:

- ShiftCoverage: Verify each shift has ≥ required_staff  backend_uploads:

- NoDoubleBooking: No employee in 2 overlapping shifts same day

- SkillMatch: All assigned staff have required skillsnetworks:

- Availability: Respect employee availability windows  default:

```    driver: bridge

```

**Soft Constraints (optimize for):**

---

```typescript

interface SoftConstraint {## Development Workflow

  name: string;

  weight: number; // Optimization weight (1-50)### Getting Started

  calculate_penalty: (assignment: Assignment[], context: Context) => number;

}1. **Repository Setup**

   ```bash

// Examples:   git clone https://github.com/yourorganization/StaffScheduler.git

- WorkloadFairness: Minimize variance in hours per employee   cd StaffScheduler

- PreferenceMatch: Maximize preferred shift assignments   ```

- ConsecutiveDays: Limit consecutive work days (≤6)

- CostOptimization: Prioritize lower-cost employees where possible2. **Development Environment**

```   ```bash

   # Install dependencies

### Objective Function   cd backend && npm install

   cd ../frontend && npm install

```   

Total_Cost = Hard_Constraints_Cost + Soft_Constraints_Cost   # Start development database

   docker-compose up -d mysql

Hard_Constraints_Cost = Σ(constraint_violations × penalty × weight)   

   # Start development servers

  Shift_Coverage_Penalty = max(0, required - assigned) × 100   npm run dev:backend   # Terminal 1

  Double_Booking_Penalty = conflicts_count × 500   npm run dev:frontend  # Terminal 2

  Skill_Mismatch_Penalty = missing_skills_count × 20   ```

  Availability_Penalty = violations_count × 1000

### Code Quality

Soft_Constraints_Cost = Σ(constraint_penalty × weight)

**Linting and Formatting**

  Workload_Variance = √(Σ(hours_i - mean_hours)²/n) × 5```bash

  Preference_Penalty = (rejected_preferences × 30) - (accepted × 20)# Backend

  Consecutive_Days = (excess_days × 15)cd backend

  Cost_Penalty = (assigned_cost - optimal_cost) × 0.1npm run lint        # ESLint checking

npm run lint:fix    # Auto-fix issues

Optimal Solution: Cost → 0npm run format      # Prettier formatting

```

# Frontend  

### Performance Characteristicscd frontend

npm run lint        # ESLint + React rules

| Metric | Value |npm run lint:fix    # Auto-fix issues

|--------|-------|npm run format      # Prettier formatting

| **100 Employees** | |```

| - Shifts: 500 | Runtime: 2-5 sec |

| - Coverage: 94-98% | Improvement: 60-80% |**Testing**

| **500 Employees** | |```bash

| - Shifts: 2500 | Runtime: 8-15 sec |# Backend unit tests

| - Coverage: 92-96% | Improvement: 50-70% |cd backend

| **1000 Employees** | |npm test

| - Shifts: 5000 | Runtime: 20-30 sec |npm run test:coverage

| - Coverage: 90-94% | Improvement: 40-60% |npm run test:watch



---# Frontend tests

cd frontend

## SYSTEM ARCHITECTUREnpm test

npm run test:coverage

### Component Interaction Flow```



```### Git Workflow

1. User Request (Frontend)

   ↓**Branch Strategy**

2. HTTP Request + JWT Token- `main`: Production-ready code

   ↓- `develop`: Integration branch for features

3. Express Middleware Layer- `feature/`: Individual feature development

   ├─ CORS Check- `hotfix/`: Critical production fixes

   ├─ JWT Verification

   ├─ Rate Limiting**Commit Convention**

   ├─ Request Logging```

   └─ Error Handlingtype(scope): description

   ↓

4. Route HandlerTypes: feat, fix, docs, style, refactor, test, chore

   ├─ Parameter ValidationScopes: auth, employees, schedules, optimization, ui

   ├─ Permission Check (RBAC)

   └─ Delegate to ServiceExamples:

   ↓feat(schedules): add constraint-based optimization

5. Service Layerfix(auth): resolve JWT token expiration handling

   ├─ Business Logicdocs(api): update employee endpoints documentation

   ├─ Data Transformation```

   ├─ Transaction Management

   └─ Optional: Call Optimization Engine### Development Database

   ↓

6. Database Access**Database Seeding**

   ├─ Query Execution```bash

   ├─ Transaction Handling# Run initialization script

   ├─ Error Recoverydocker-compose exec mysql mysql -u root -p staff_scheduler < /docker-entrypoint-initdb.d/init.sql

   └─ Connection Pooling

   ↓# Add sample data

7. Response Formattingcd backend

   ├─ Success Responsenpm run seed:dev

   └─ Error Response```

   ↓

8. HTTP Response to Client**Database Migrations**

   ↓```bash

9. Frontend Processing# Create new migration

   ├─ State Updatenpm run migration:create add_new_feature

   ├─ UI Re-render

   └─ User Feedback# Run pending migrations

```npm run migration:run



### Service Layer Architecture# Rollback last migration

npm run migration:rollback

``````

ScheduleService

├─ create(scheduleData)---

├─ findById(id)

├─ update(id, data)## Production Deployment

├─ delete(id)

├─ generateOptimizedSchedule(scheduleId, userId)  ← Calls ScheduleOptimizer### Deployment Checklist

├─ publishSchedule(id, userId)

├─ getScheduleStats(id)**Pre-Deployment**

└─ archiveSchedule(id)- [ ] Update all environment variables for production

- [ ] Configure SSL certificates

EmployeeService- [ ] Set up external database (if not using Docker MySQL)

├─ create(employeeData)- [ ] Configure backup strategy

├─ findById(id)- [ ] Set up monitoring and logging

├─ update(id, data)- [ ] Perform security audit

├─ list(filters)

├─ addSkill(employeeId, skillId)**Environment Configuration**

├─ removeSkill(employeeId, skillId)```bash

└─ getEmployeeSchedule(id, dateRange)# Production .env

NODE_ENV=production

DepartmentServiceDEBUG=false

├─ create(deptData)

├─ findById(id)# Use strong, unique secrets

├─ list(filters)JWT_SECRET=$(openssl rand -base64 32)

├─ updateHierarchy(id, parentId)SESSION_SECRET=$(openssl rand -base64 32)

├─ getSubordinates(id)

└─ getDepartmentStats(id)# Database with strong passwords

MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32)

UserServiceMYSQL_PASSWORD=$(openssl rand -base64 32)

├─ create(userData)

├─ findById(id)# Logging

├─ authenticate(email, password)LOG_LEVEL=warn

├─ updatePassword(id, newPassword)LOG_FILE_ENABLED=true

├─ list(filters)

└─ assignRole(id, role, department)# Security

RATE_LIMIT_WINDOW=15

ShiftServiceRATE_LIMIT_MAX_REQUESTS=100

├─ create(shiftData)BCRYPT_SALT_ROUNDS=12

├─ findById(id)```

├─ update(id, data)

├─ list(filters)### SSL Configuration

├─ addRequiredSkill(shiftId, skillId)

└─ calculateDuration(startTime, endTime)**Let's Encrypt with Nginx**

``````nginx

server {

---    listen 443 ssl http2;

    server_name yourdomain.com;

## PERFORMANCE & SCALABILITY    

    ssl_certificate /etc/ssl/certs/fullchain.pem;

### Database Performance    ssl_certificate_key /etc/ssl/private/privkey.pem;

    

**Indexes Implemented:**    # Security headers

- Primary keys on all tables    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

- Composite indexes on foreign key + status combinations    add_header X-Frame-Options DENY always;

- Unique indexes on identifier fields (email, employee_id, code)    add_header X-Content-Type-Options nosniff always;

- Timestamp indexes for time-range queries    

    location / {

**Query Performance Targets:**        proxy_pass http://frontend:3000;

- Simple SELECT (indexed): < 5ms        proxy_set_header Host $host;

- JOIN queries (3-4 tables): < 50ms        proxy_set_header X-Real-IP $remote_addr;

- Aggregation queries: < 200ms        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

- Full table scans: < 1000ms (acceptable for analytics)        proxy_set_header X-Forwarded-Proto $scheme;

    }

**Connection Pooling:**    

- Min pool size: 5 connections    location /api {

- Max pool size: 20 connections        proxy_pass http://backend:3001;

- Connection timeout: 10 seconds        proxy_set_header Host $host;

- Idle timeout: 900 seconds        proxy_set_header X-Real-IP $remote_addr;

        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

### API Response Times        proxy_set_header X-Forwarded-Proto $scheme;

    }

| Endpoint | Complexity | Target | 95th %ile |}

|----------|-----------|--------|-----------|```

| GET /schedules | Low | 50ms | 100ms |

| GET /schedules/:id | Medium | 100ms | 200ms |### Health Monitoring

| POST /schedules/:id/generate | High | 5000ms | 10000ms |

| GET /employees | Medium | 100ms | 200ms |**Health Check Endpoints**

| GET /dashboard/stats | High | 500ms | 1000ms |```typescript

// GET /health

### Optimization Scaling{

  "success": true,

**Linear Complexity Analysis:**  "message": "Staff Scheduler API is running",

  "timestamp": "2024-01-01T12:00:00Z",

```  "environment": "production",

Greedy Phase: O(n·m·log k)  "uptime": 86400,

  n = 100 employees → 500ms  "memory": {

  n = 500 employees → 1.2s    "used": "245MB",

  n = 1000 employees → 2.5s (extrapolated)    "free": "1.2GB"

  },

SA Phase: O(I·n·m) where I = iterations  "database": {

  I = 10000, n = 100, m = 500    "status": "connected",

  Time = 2-5 seconds    "responseTime": "2ms"

  }

Total Time = Greedy + SA = 2.5-7.5 seconds typical}

``````



### Horizontal Scaling**Docker Health Checks**

```dockerfile

**Recommendations:**HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \

- Load balancing: Nginx upstream for multiple backends  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

- Session persistence: Redis for JWT cache```

- Database replication: MySQL master-replica for reads

- Caching layer: Redis for frequently accessed data### Backup Strategy



```**Database Backups**

┌─────────────────────────────────────┐```bash

│         Load Balancer (Nginx)       │#!/bin/bash

└──────────────────┬──────────────────┘# backup.sh

                   │DATE=$(date +%Y%m%d_%H%M%S)

        ┌──────────┼──────────┐BACKUP_DIR="/backups"

        │          │          │DB_NAME="staff_scheduler"

    ┌───▼──┐  ┌───▼──┐  ┌───▼──┐

    │ API1 │  │ API2 │  │ API3 │# Create backup

    └───┬──┘  └───┬──┘  └───┬──┘docker-compose exec mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} ${DB_NAME} > ${BACKUP_DIR}/backup_${DATE}.sql

        │         │         │

        └────┬────┴────┬────┘# Compress backup

             │         │gzip ${BACKUP_DIR}/backup_${DATE}.sql

        ┌────▼──┐   ┌──▼────┐

        │ Redis │   │ MySQL  │# Upload to S3 (optional)

        └───────┘   └────────┘aws s3 cp ${BACKUP_DIR}/backup_${DATE}.sql.gz s3://your-backup-bucket/

            (Cache) (Database)

```# Cleanup old backups (keep 30 days)

find ${BACKUP_DIR} -name "backup_*.sql.gz" -mtime +30 -delete

---```



## CONFIGURATION REFERENCE**Automated Backup Cron**

```bash

### Environment Variables# Run daily at 2 AM

0 2 * * * /path/to/backup.sh >> /var/log/backup.log 2>&1

```bash```

# Database Configuration

DB_HOST=localhost                  # MySQL hostname---

DB_PORT=3306                       # MySQL port

DB_USER=scheduler_user             # DB username## Performance & Scaling

DB_PASSWORD=password_min_16_chars  # DB password (min 16 chars)

DB_NAME=staff_scheduler            # Database name### Performance Targets

DB_POOL_MIN=5                      # Connection pool minimum

DB_POOL_MAX=20                     # Connection pool maximum**Response Times**

- API endpoints: < 200ms (95th percentile)

# Application- Dashboard loading: < 3 seconds

NODE_ENV=production                # Environment (development/production)- Schedule optimization: < 30 seconds (medium problems)

BACKEND_PORT=3001                  # Backend API port- Database queries: < 50ms (95th percentile)

FRONTEND_PORT=3000                 # Frontend port

**Throughput**

# JWT Authentication- Concurrent users: 100+ (single instance)

JWT_SECRET=base64_encoded_secret   # Min 32 characters (base64)- API requests: 1000+ req/sec

JWT_EXPIRY=7d                      # Token expiration (e.g., 7d, 24h)- Database connections: 50+ concurrent

JWT_ISSUER=staff-scheduler         # Token issuer name

JWT_AUDIENCE=api.staff-scheduler   # Token audience### Optimization Strategies



# Security**Database Optimization**

BCRYPT_ROUNDS=12                   # Password hash rounds (10-14)```sql

SESSION_SECRET=session_secret      # Session encryption secret-- Essential indexes for performance

CORS_ORIGIN=http://localhost:3000  # Frontend origin for CORSCREATE INDEX idx_employees_department ON employees(department);

CREATE INDEX idx_employees_active ON employees(is_active);

# Rate LimitingCREATE INDEX idx_shifts_date_dept ON shifts(date, department);

RATE_LIMIT_WINDOW_MS=900000        # 15 minutesCREATE INDEX idx_assignments_employee_date ON assignments(employee_id, created_at);

RATE_LIMIT_MAX_REQUESTS=100        # Requests per windowCREATE INDEX idx_assignments_status ON assignments(status);



# Logging-- Composite indexes for complex queries

LOG_LEVEL=info                     # Log level (debug/info/warn/error)CREATE INDEX idx_shifts_complex ON shifts(department, date, status);

LOG_FORMAT=json                    # Format (json/text)CREATE INDEX idx_hierarchy_path ON users(hierarchy_path, hierarchy_level);

```

# Optimization Engine

OPTIMIZER_MAX_ITERATIONS=10000     # Max SA iterations**Caching Strategy**

OPTIMIZER_TIMEOUT_SECONDS=300      # Timeout in seconds```typescript

OPTIMIZER_TEMPERATURE=100          # Initial temperature// Redis caching for frequently accessed data

OPTIMIZER_COOLING_RATE=0.95        # Cooling rateconst cache = {

  employees: {

# Optional Services    key: 'employees:active',

REDIS_HOST=localhost               # Redis hostname (optional)    ttl: 300 // 5 minutes

REDIS_PORT=6379                    # Redis port  },

REDIS_PASSWORD=                    # Redis password  dashboard: {

    key: 'dashboard:stats',

# Notifications    ttl: 60 // 1 minute

MAIL_HOST=smtp.example.com         # SMTP server  },

MAIL_PORT=587                      # SMTP port  schedules: {

MAIL_USER=noreply@example.com      # SMTP user    key: 'schedules:published',

MAIL_PASSWORD=password             # SMTP password    ttl: 3600 // 1 hour

MAIL_FROM=noreply@example.com      # From address  }

```};



### Application Settings (Stored in Database)// Implementation

async function getCachedEmployees(): Promise<Employee[]> {

```sql  const cached = await redis.get(cache.employees.key);

-- System-wide configuration  if (cached) {

INSERT INTO system_settings (key, value, type, description) VALUES    return JSON.parse(cached);

('max_consecutive_work_days', '6', 'integer', 'Max consecutive days'),  }

('min_hours_between_shifts', '8', 'integer', 'Hours between shifts'),  

('labor_cost_limit_monthly', '50000', 'decimal', 'Monthly labor budget'),  const employees = await database.query('SELECT * FROM employees WHERE is_active = true');

('schedule_look_ahead_days', '90', 'integer', 'Schedule planning window'),  await redis.setex(cache.employees.key, cache.employees.ttl, JSON.stringify(employees));

('fairness_threshold', '0.8', 'decimal', 'Acceptable fairness score');  

```  return employees;

}

---```



## DEPLOYMENT GUIDE**Connection Pooling**

```typescript

### Docker Compose (Development)// MySQL connection pool configuration

const pool = mysql.createPool({

```bash  host: process.env.DB_HOST,

# Start all services  user: process.env.DB_USER,

docker-compose up -d  password: process.env.DB_PASSWORD,

  database: process.env.DB_NAME,

# Check status  connectionLimit: 50,

docker-compose ps  acquireTimeout: 60000,

  timeout: 60000,

# View logs  reconnect: true,

docker-compose logs -f backend  charset: 'utf8mb4'

docker-compose logs -f frontend});

```

# Stop services

docker-compose down### Horizontal Scaling



# Clean volumes**Load Balancer Configuration**

docker-compose down -v```nginx

```upstream backend {

    server backend-1:3001;

**Services:**    server backend-2:3001;

- `backend`: Node.js API (port 3001)    server backend-3:3001;

- `frontend`: React app (port 3000)}

- `mysql`: Database (port 3306)

- `redis`: Cache (port 6379)upstream frontend {

- `phpmyadmin`: DB admin (port 8080)    server frontend-1:3000;

    server frontend-2:3000;

### Docker Compose (Production)}



```yamlserver {

# Production overrides in docker-compose.prod.yml    location /api {

- Remove volumes (use managed storage)        proxy_pass http://backend;

- Set replicas for backends        proxy_set_header Host $host;

- Configure logging to syslog        proxy_set_header X-Real-IP $remote_addr;

- Enable health checks    }

- Add resource limits    

```    location / {

        proxy_pass http://frontend;

### Manual Deployment        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;

**Prerequisites:**    }

```bash}

# Node.js 18+ with npm```

node --version  # v18.0.0+

npm --version**Docker Swarm Deployment**

```yaml

# MySQL 8.0+# docker-compose.swarm.yml

mysql --version  # 8.0+version: '3.8'

```

services:

**Backend Setup:**  backend:

```bash    image: staffscheduler-backend:latest

cd backend    deploy:

npm install      replicas: 3

npm run build      restart_policy:

npm run migrate        condition: on-failure

NODE_ENV=production npm start      resources:

```        limits:

          cpus: '1.0'

**Frontend Setup:**          memory: 1G

```bash        reservations:

cd frontend          cpus: '0.5'

npm install          memory: 512M

npm run build    networks:

# Serve build with Nginx or Express static      - staff_scheduler

```

  frontend:

### Kubernetes Deployment    image: staffscheduler-frontend:latest

    deploy:

**Prerequisites:**      replicas: 2

- Kubernetes 1.24+      restart_policy:

- kubectl configured        condition: on-failure

- Docker images built and pushed to registry    networks:

      - staff_scheduler

**Deployment:**

```bashnetworks:

# Namespace  staff_scheduler:

kubectl create namespace staff-scheduler    driver: overlay

```

# Secrets

kubectl create secret generic db-credentials \---

  --from-literal=password=secure_password \

  -n staff-scheduler## Troubleshooting & Maintenance



# ConfigMap### Common Issues

kubectl create configmap backend-config \

  --from-file=.env.production \**Database Connection Issues**

  -n staff-scheduler```bash

# Check database status

# Deploydocker-compose logs mysql

kubectl apply -f k8s/ -n staff-scheduler

# Test connection manually

# Verifydocker-compose exec mysql mysql -u ${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE}

kubectl get pods -n staff-scheduler

kubectl logs deployment/backend -n staff-scheduler# Restart database

```docker-compose restart mysql

```

**Manifest Files (k8s/):**

```**Application Errors**

k8s/```bash

├── namespace.yaml# Check application logs

├── configmap.yamldocker-compose logs backend

├── secret.yamldocker-compose logs frontend

├── mysql-deployment.yaml

├── backend-deployment.yaml# Access running container

├── backend-service.yamldocker-compose exec backend bash

├── frontend-deployment.yamldocker-compose exec frontend sh

├── frontend-service.yaml

├── ingress.yaml# Check health status

└── hpa.yaml (Horizontal Pod Autoscaler)curl http://localhost:3001/health

```curl http://localhost:3000/health

```

---

**Performance Issues**

## MAINTENANCE & MONITORING```bash

# Monitor resource usage

### Health Monitoringdocker stats



**Endpoints:**# Database performance

```bashdocker-compose exec mysql mysql -u root -p -e "SHOW PROCESSLIST;"

# System healthdocker-compose exec mysql mysql -u root -p -e "SHOW STATUS LIKE 'Threads%';"

curl http://localhost:3001/api/health

# Application metrics

# Databasecurl http://localhost:3001/metrics

curl http://localhost:3001/api/health/database```



# Memory### Maintenance Tasks

curl http://localhost:3001/api/health/memory

```**Daily Maintenance**

```bash

**Metrics:**#!/bin/bash

- Response time: < 100ms (alert: > 500ms)# daily-maintenance.sh

- Error rate: < 0.1% (alert: > 1%)

- CPU usage: < 70% (alert: > 85%)# Check system health

- Memory usage: < 80% (alert: > 90%)curl -f http://localhost:3001/health || exit 1

- Database connections: < 15/20 (alert: > 18)

# Backup database

### Backup & Recovery./backup.sh



**Database Backup:**# Clean up old logs

```bashfind /var/log -name "*.log" -mtime +7 -delete

# Full backup

mysqldump -u scheduler_user -p staff_scheduler > backup.sql# Update system statistics

docker-compose exec mysql mysql -u root -p -e "ANALYZE TABLE employees, shifts, assignments;"

# Restore```

mysql -u scheduler_user -p staff_scheduler < backup.sql

**Weekly Maintenance**

# Automated: Cron job```bash

0 2 * * * mysqldump -u root -p${MYSQL_ROOT_PASSWORD} staff_scheduler | gzip > /backups/backup_$(date +\%Y\%m\%d).sql.gz#!/bin/bash

```# weekly-maintenance.sh



**Retention Policy:**# Optimize database tables

- Daily backups: Keep 7 daysdocker-compose exec mysql mysql -u root -p -e "OPTIMIZE TABLE employees, shifts, assignments, schedules;"

- Weekly backups: Keep 4 weeks

- Monthly backups: Keep 12 months# Clean up old audit logs

docker-compose exec mysql mysql -u root -p -e "DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);"

### Database Maintenance

# Update Docker images

```bashdocker-compose pull

# Optimize tablesdocker system prune -f

OPTIMIZE TABLE schedules, assignments, employees;```



# Analyze tables**Monthly Maintenance**

ANALYZE TABLE schedules, assignments, employees;```bash

#!/bin/bash

# Check integrity# monthly-maintenance.sh

CHECK TABLE schedules, assignments, employees;

# Full database backup

# Rebuild indexes./full-backup.sh

REPAIR TABLE schedules, assignments;

```# Security updates

docker-compose build --no-cache --pull

### Log Managementdocker-compose up -d



**Rotation:**# Performance analysis

- Max size: 100MB per file./performance-report.sh

- Retention: 30 days

- Compression: gzip# Cleanup old backups

find /backups -name "*.sql.gz" -mtime +90 -delete

**Aggregation (optional):**```

- ELK Stack (Elasticsearch, Logstash, Kibana)

- Splunk### Monitoring & Alerting

- CloudWatch (AWS)

**System Metrics**

---```typescript

// Performance monitoring endpoint

## TROUBLESHOOTINGapp.get('/metrics', (req, res) => {

  const metrics = {

### Common Issues & Solutions    uptime: process.uptime(),

    memory: process.memoryUsage(),

| Issue | Cause | Solution |    cpu: process.cpuUsage(),

|-------|-------|----------|    activeConnections: getActiveConnections(),

| "Port already in use" | Another service on port | `lsof -i :3001` then kill process |    databaseStatus: await checkDatabaseHealth(),

| "Cannot connect to database" | MySQL not running | `docker-compose up mysql` |    cacheStatus: await checkCacheHealth()

| "Schedule generation timeout" | Large dataset, slow hardware | Reduce scope or increase timeout |  };

| "Type mismatch errors" | Frontend-backend version mismatch | Ensure matching TypeScript types |  

| "Memory exceeded" | Large schedules (1000+ employees) | Increase container memory limit |  res.json(metrics);

| "Rate limit exceeded" | Too many requests | Wait 15 minutes or adjust RATE_LIMIT_MAX |});

```

### Debug Mode

**Alert Conditions**

```bash- API response time > 1 second

# Backend- Database connection failures

NODE_ENV=development LOG_LEVEL=debug npm start- Memory usage > 85%

- Disk space < 10%

# Frontend- Failed health checks for > 3 minutes

REACT_APP_DEBUG=true npm start

**Log Analysis**

# Database queries```bash

SET @@global.general_log = 'ON';# Error tracking

SHOW VARIABLES LIKE 'general_log%';grep -i error /var/log/staff-scheduler/app.log | tail -100

```

# Performance monitoring

### Performance Profilinggrep "slow query" /var/log/mysql/slow-query.log



**Node.js Profiling:**# Security monitoring

```bashgrep "authentication failed" /var/log/staff-scheduler/app.log

# CPU profile```

node --prof backend/src/index.ts

node --prof-process isolate-*.log > profile.txt---



# Memory profile## Appendix

node --inspect backend/src/index.ts

# Open chrome://inspect### API Response Codes

```

| Code | Description | Usage |

---|------|-------------|-------|

| 200 | OK | Successful GET, PUT requests |

**Version:** 1.0.0  | 201 | Created | Successful POST requests |

**Last Updated:** October 24, 2025  | 204 | No Content | Successful DELETE requests |

**Maintainer:** Luca Ostinelli| 400 | Bad Request | Invalid input data |

| 401 | Unauthorized | Authentication required |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists |
| 422 | Unprocessable Entity | Validation errors |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server errors |

### Database Maintenance Queries

```sql
-- Check database size
SELECT 
  table_schema AS 'Database',
  ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)'
FROM information_schema.tables 
WHERE table_schema = 'staff_scheduler'
GROUP BY table_schema;

-- Analyze table performance
SELECT 
  table_name,
  table_rows,
  ROUND(data_length / 1024 / 1024, 2) AS 'Data Size (MB)',
  ROUND(index_length / 1024 / 1024, 2) AS 'Index Size (MB)'
FROM information_schema.tables 
WHERE table_schema = 'staff_scheduler'
ORDER BY data_length DESC;

-- Check for unused indexes
SELECT 
  s.table_schema,
  s.table_name,
  s.index_name,
  s.cardinality
FROM information_schema.statistics s
LEFT JOIN information_schema.index_statistics i ON (
  s.table_schema = i.table_schema AND 
  s.table_name = i.table_name AND 
  s.index_name = i.index_name
)
WHERE s.table_schema = 'staff_scheduler'
AND i.index_name IS NULL
AND s.index_name != 'PRIMARY';
```

### Security Checklist

**Production Security**
- [ ] Change all default passwords
- [ ] Use strong JWT secrets (256+ bits)
- [ ] Enable SSL/TLS for all connections
- [ ] Configure firewall rules
- [ ] Set up fail2ban for SSH
- [ ] Enable audit logging
- [ ] Regular security updates
- [ ] Backup encryption
- [ ] Access log monitoring
- [ ] Penetration testing

**Application Security**
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention
- [ ] XSS protection
- [ ] CSRF tokens where needed
- [ ] Rate limiting configured
- [ ] Error message sanitization
- [ ] File upload restrictions
- [ ] Session security
- [ ] Password policies
- [ ] Account lockout mechanisms

---

**Version**: 1.0.0  
**Last Updated**: 2024-01-01  
**Author**: Luca Ostinelli  
**License**: MIT
      - [Error Codes](#error-codes)
      - [Rate Limiting](#rate-limiting-1)
    - [WebSocket API for Real-time Updates](#websocket-api-for-real-time-updates)
      - [Connection Management](#connection-management)
      - [Real-time Channels](#real-time-channels)
  - [10. Deployment Configuration](#10-deployment-configuration)
    - [Docker Configuration](#docker-configuration)
      - [Multi-stage Production Dockerfile](#multi-stage-production-dockerfile)
      - [Production Docker Compose](#production-docker-compose)
    - [Environment Configuration](#environment-configuration)
      - [Production Environment Variables](#production-environment-variables)
    - [Kubernetes Deployment (Optional)](#kubernetes-deployment-optional)
      - [Deployment Configuration](#deployment-configuration)
    - [Monitoring \& Observability](#monitoring--observability)
      - [Health Checks](#health-checks)
      - [Logging Configuration](#logging-configuration)


---

## 1. Problem Statement

The Staff Scheduler aims to assign employees to shifts over a given time horizon, respecting hard constraints (legal, contractual, operational) and optimizing for soft preferences (employee wishes, fairness, target hours). The system must support flexible roles, overlapping coverage intervals, and individual overrides.

### Core Requirements
- **Multi-Level Hierarchy**: Unlimited organizational depth with role-based permissions
- **Constraint Programming**: Hard and soft constraints with lexicographic optimization  
- **Real-time Collaboration**: Multiple supervisors editing simultaneously
- **Scalability**: 100+ employees, 1000+ shifts per month
- **Compliance**: Legal/union requirements, audit trails
- **Flexibility**: Manual overrides, exemption requests, delegation

---

## 2. Complete Mathematical Model

### Sets and Indices
- $E$: Employees, index $i$.
- $R$: Roles (e.g., Nurse, Doctor, OSS), index $r$. No hierarchy - roles are equivalent in seniority.
- $T$: Shifts, index $t$. Each $t$ has $(\text{start}_t, \text{end}_t)$ timestamps. Includes regular and special shifts.
- $F$: Coverage intervals, index $f$ (arbitrary, possibly overlapping).
- $S$: Special shift types (on-call, overtime, emergency), index $s$.
- $H$: Hierarchy levels in organization, index $h$.
- $U$: Organizational units, index $u$.

### Parameters
- `coverage_mode ∈ {per_role, total}` (default: per_role)
- `role_flex ∈ {strict, flexible}` (default: strict)
- $A_{i,r}$: Matrix of roles each employee can cover (if flexible)
- $[\text{from}_i, \text{to}_i]$: Contract validity for employee $i$
- $\text{min}_{f,r}, \text{max}_{f,r}$: Min/max coverage for each interval/role
- $\text{rest\_hrs}_r$, $\text{rest\_hrs}_i$: Minimum rest hours per role/employee
- $\text{target\_hrs}_{r,\mathcal{H}}$, $\text{target\_hrs}_{i,\mathcal{H}}$: Target hours per role/employee for horizon $\mathcal{H}$

### Decision Variables
- $x_{i,t} \in \{0,1\}$: Employee $i$ assigned to shift $t$
- $y_{i,t,r} \in \{0,1\}$: (Flexible) Employee $i$ covers role $r$ in shift $t$
- $u^{(2)}_{i,g,X}, u^{(1)}_{i,g} \in \{0,1\}$: Preference satisfaction indicators
- $m_{i,X} \in \mathbb{Z}_{\ge0}$: Count of assignments to undesired intervals
- $\delta_i \ge 0$: Absolute deviation from target hours
- $z$: Minimum satisfaction score (for fairness)
- $d_{f,r} \ge 0$: Coverage deficit variables (only in PARTIAL mode)

### Hard Constraints (Absolute Priority)

#### 1. Forced Assignments (Management Directives)
For any forced assignment $(i,t)$ mandated by authorized supervisor:

$$x_{i,t} = 1$$

**Priority**: Highest - overrides all other constraints except basic feasibility

#### 2. Availability and Basic Feasibility
- **Contract validity**: $x_{i,t} = 0$ if $t$ outside $[\text{from}_i, \text{to}_i]$
- **No overlap**: $x_{i,t} + x_{i,t'} \leq 1$ if $\text{overlap}(t,t') > 0$
- **Approved absences**: $x_{i,t} = 0$ if $i$ has approved absence during $t$

#### 3. Minimum Rest Requirements (Legal/Union)
For each employee $i$ and shift pair $(t,t')$:

$$x_{i,t} + x_{i,t'} \leq 1 \quad \text{if } \Delta(t,t') < \text{rest\_hrs}_i$$

Where $\text{rest\_hrs}_i$ comes from personal override or role default.

#### 4. Hierarchical Constraint Inheritance
For constraint $C$ imposed at hierarchy level $h$ on organizational unit $u$:
- Applies to all employees in sub-units of $u$
- Can be overridden only by:
  - The supervisor who imposed $C$
  - A supervisor at same level $h$ with authority over $u$
  - Higher-level supervisor (level $< h$) through exemption approval

Mathematically, if constraint $C$ requires $\sum_{i \in U_{sub}} x_{i,T_C} \leq B_C$:

$$\sum_{i \in \text{descendants}(u)} x_{i,t} \leq B_C \quad \forall t \in T_C$$

unless exemption $E_{i,t,C}$ is approved.

#### 5. Coverage Requirements (Standard Formula)
For each coverage interval $f$ and role $r$:

$$\min_{f,r} \leq \sum_{t \in T_f} \sum_{i \in E_r} x_{i,t} \leq \max_{f,r}$$

Where:
- $T_f$: Set of shifts within coverage interval $f$
- $E_r$: Set of employees who can cover role $r$
- $x_{i,t}$: Decision variable = 1 if employee $i$ assigned to shift $t$
- $\min_{f,r}$, $\max_{f,r}$: Coverage requirements

#### 6. Role Assignment Consistency (Flexible Mode)

$$\sum_r y_{i,t,r} = x_{i,t} \quad \forall i,t$$

$$y_{i,t,r} \leq A_{i,r} \quad \forall i,t,r$$

### Soft Constraints (Preference Optimization)

#### 1. Employee Preferences (Hierarchical Priority)
**Level 1 (Highest Soft Priority)**: Day-off requests

$$u^{(1)}_{i,g} \leq 1 - \sum_{t \in \text{day}(g)} x_{i,t}$$

**Level 2**: Avoid specific intervals

$$u^{(2)}_{i,g,X} \leq 1 - \sum_{t \in (\text{day}(g) \cap X)} x_{i,t}$$

**Level 3 (Lowest Soft Priority)**: Minimize undesired assignments

$$m_{i,X} = \sum_{t \in X} x_{i,t}$$

#### 2. Target Hours Deviation

$$\text{hours}_i - \text{target}_i \leq \delta_i \quad \forall i$$

$$\text{target}_i - \text{hours}_i \leq \delta_i \quad \forall i$$

Where: $\text{hours}_i = \sum_t x_{i,t} \cdot \text{duration}(t)$

#### 3. Fairness (Max-Min Satisfaction)

$$S_i = \sum u^{(1)}_{i,\cdot} + \sum u^{(2)}_{i,\cdot,\cdot} - \alpha \sum_X m_{i,X}$$

$$z \leq S_i \quad \forall i$$

### Hierarchical Management Constraints

#### Delegation and Authority Transfer
If user $s_1$ delegates authority $A$ to user $s_2$ for scope $\Sigma$:
- $s_2$ can impose constraints within $\Sigma$ as if they were $s_1$
- Delegation cannot exceed $s_1$'s original authority level
- $s_1$ retains ability to revoke delegation

#### Exemption Request System
For exemption $E$ from constraint $C$ imposed by supervisor $s$:

$$\text{valid}(E) \iff (\text{requestor} \text{ subordinate of } s) \land (\text{approver} \geq \text{level}(s))$$

### Objective Function (Lexicographic Optimization)

**Phase 1**: Maximize hard constraint satisfaction

$$\max \text{feasibility\_score}$$

**Phase 2**: Optimize soft constraints with hierarchy

$$\max W_1 \sum u^{(1)} + W_2 \sum u^{(2)} - W_3 \sum m_{i,X}$$

Where $W_1 > W_2 > W_3$ ensures preference hierarchy.

**Phase 3**: Maximize fairness

$$\max z$$

**Phase 4**: Minimize target deviation

$$\min \sum_i \delta_i$$

**Phase 5** (Optional): Minimize schedule changes

$$\min \sum_{i,t} |x_{i,t} - x^{\text{prev}}_{i,t}|$$

### Conflict Resolution Algorithm

#### Multi-Supervisor Coordination
Since supervisors at same level can modify each other's constraints:

1. **Last-Write-Wins with Audit**: Most recent change takes precedence
2. **Notification Chain**: All affected supervisors notified of changes
3. **Automatic Feasibility Check**: System validates after each change
4. **Escalation Trigger**: If infeasible, escalate to common superior

#### Mathematical Representation
For conflicting constraints $C_1, C_2$ from supervisors at same level:

$$\text{active\_constraint} = \arg\max_{C \in \{C_1, C_2\}} \text{timestamp}(C)$$

### Exemption and Override System

#### Exemption Variables
$e_{i,t,C} \in \{0,1\}$: Exemption granted for employee $i$ in shift $t$ from constraint $C$

Modified constraint becomes:

$$\text{original\_constraint}(i,t) \lor e_{i,t,C} = 1$$

#### Approval Chain
Exemption $e_{i,t,C}$ valid only if:

$$\exists s : (\text{level}(s) \leq \text{level}(\text{creator}(C))) \land \text{approved\_by}(e,s)$$

---

## 3. System Architecture

### Technology Stack
- **Frontend**: React 18.2.0 with TypeScript 5.1.6
- **Backend**: Node.js 18+ with Express 4.18.2 (TypeScript)
- **Database**: MySQL 8.0 with materialized paths for hierarchy
- **Authentication**: JWT tokens with bcrypt password hashing
- **Optimization**: OR-Tools or similar constraint solver
- **Reports**: PDF generation (Puppeteer), Excel export (ExcelJS)
- **Real-time**: WebSocket for collaborative editing
- **Deployment**: Docker containers with docker-compose

### Architecture Patterns
- **N-Tier Architecture**: Presentation, Business Logic, Data Access
- **Event-Driven**: For real-time updates and integrations
- **Repository Pattern**: Data access abstraction
- **Service Layer**: Business logic encapsulation
- **Middleware Stack**: Authentication, validation, logging, rate limiting

---

## 4. Complete TypeScript Type System

### Core Authentication & User Types

```typescript
// User Authentication with N-level hierarchy
export interface User {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  salt?: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  parentSupervisor?: string;
  hierarchyLevel: number;  // 0 = admin, 1+ = increasing depth
  hierarchyPath: string;   // Materialized path: "0.1.3.7"
  permissions: Permission[];
  delegatedAuthorities?: DelegatedAuthority[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  lastLogin?: Date;
  resetToken?: string;
  resetTokenExpiry?: Date;
  notificationToken?: string;
  maxSubordinateLevel?: number;  // How deep they can create users
  isActive: boolean;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
}

export interface LoginRequest {
  username?: string;
  email?: string;
  password: string;
  rememberMe?: boolean;
}

export interface LoginResponse {
  user: Omit<User, 'passwordHash' | 'salt'>;
  token: string;
  hierarchyContext: HierarchyContext;
}

export interface HierarchyContext {
  level: number;
  canCreateUsers: boolean;
  maxSubordinateLevel: number;
  accessibleUnits: string[];
  delegatedAuthorities: DelegatedAuthority[];
}

export interface Permission {
  resource: 'employees' | 'shifts' | 'schedules' | 'reports' | 'settings' | 'users';
  action: 'read' | 'write' | 'delete' | 'approve' | 'create_user';
  scope: 'all' | 'hierarchy_down' | 'unit' | 'self';
  conditions?: Record<string, any>;
}

export interface DelegatedAuthority {
  id: string;
  type: 'forced_assignment' | 'availability_override' | 'constraint_exception';
  targetEmployeeId?: string;
  targetShiftId?: string;
  targetTimeRange?: { start: string; end: string };
  description: string;
  isActive: boolean;
  expiresAt?: Date;
  delegatedBy: string;
}
```

### Employee & Organizational Types

```typescript
// Employee with complete organizational support
export interface Employee {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  hireDate: string;
  contractFrom: string;
  contractTo: string;
  workPatterns: WorkPattern;
  skills: string[];
  preferences: EmployeePreferences;
  emergencyContact: EmergencyContact;
  primaryUnit: string;
  secondaryUnits?: string[];
  primarySupervisor: string;
  secondarySupervisors?: string[];
  hierarchyPath: string;
  isActive: boolean;
  restHours?: number;
  targetHours?: Record<string, number>;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkPattern {
  preferredShifts: string[];
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  availableDays: string[];
  unavailableDates: string[];
  preferredTimeSlots: TimeSlot[];
  restrictions?: string[];
}

export interface TimeSlot {
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  days: string[];     // ['monday', 'tuesday', ...]
}

export interface EmployeePreferences {
  preferredDepartments: string[];
  avoidNightShifts: boolean;
  flexibleSchedule: boolean;
  maxConsecutiveDays: number;
  preferredDaysOff: string[];
  notes?: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
  email?: string;
}
```

### Shift & Schedule Types

```typescript
// Comprehensive shift management
export interface Shift {
  id: string;
  name: string;
  startTime: string;  // Time format HH:MM
  endTime: string;    // Time format HH:MM
  date: string;       // ISO date YYYY-MM-DD
  department: string;
  position: string;
  requiredSkills: string[];
  minimumStaff: number;
  maximumStaff: number;
  type: 'regular' | 'special';
  specialType?: 'on_call' | 'overtime' | 'emergency' | 'holiday';
  priority: number;
  location?: string;
  description?: string;
  status: 'draft' | 'published' | 'archived';
  rolesRequired: Record<string, number>;  // role -> minimum count
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  employeeId: string;
  shiftId: string;
  role: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  assignedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedReason?: string;
  notes?: string;
}

export interface ForcedAssignment {
  id: string;
  employeeId: string;
  shiftId: string;
  createdBy: string;
  createdAt: Date;
  justification: string;
  priority: 'emergency' | 'operational' | 'administrative';
  overrides: string[];  // List of constraints this overrides
  canBeExempted: boolean;
}

export interface ScheduleResult {
  id: string;
  assignments: Assignment[];
  unassignedShifts?: Shift[];
  constraintViolations?: ConstraintViolation[];
  stats: ScheduleStats;
  generatedAt: Date;
  parameters: ScheduleParameters;
  status: 'draft' | 'approved' | 'active' | 'archived';
  approvedBy?: string;
  approvedAt?: Date;
}

export interface ScheduleStats {
  fairness: number;
  preferenceSatisfaction: number;
  targetDeviation: number;
  coverageRate: number;
  employeeUtilization: Record<string, number>;
  constraintViolationCount: number;
  hardConstraintViolations: number;
  softConstraintViolations: number;
}

export interface ScheduleParameters {
  coverageMode: 'per_role' | 'total';
  roleFlex: 'strict' | 'flexible';
  horizon: 'weekly' | 'monthly' | 'annual';
  mode: 'strict' | 'partial' | 'whatif';
  optimizationLevel: 'fast' | 'balanced' | 'optimal';
  solver: 'ortools' | 'cplex' | 'gurobi' | 'custom';
  includePreferences: boolean;
  maximizeFairness: boolean;
  minimizeChanges: boolean;
}

export interface ConstraintViolation {
  type: 'hard' | 'soft';
  constraint: string;
  employeeId?: string;
  shiftId?: string;
  severity: number;
  message: string;
  suggestion?: string;
}
```

### Constraint & Hierarchy Types

```typescript
// Hierarchical constraint system
export interface HierarchicalConstraint {
  id: string;
  type: 'max_consecutive' | 'no_night_shifts' | 'mandatory_coverage' | 'forced_assignment' | 'rest_requirement' | 'skill_requirement';
  createdBy: string;
  hierarchyLevel: number;
  appliesTo: 'employee' | 'unit' | 'role' | 'hierarchy_branch';
  targetScope: string[];
  parameters: Record<string, any>;
  inheritanceRule: 'cascade_down' | 'direct_only' | 'skip_one_level';
  exemptionPolicy: 'no_exemptions' | 'same_level_approval' | 'higher_level_approval';
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
  priority: number;
}

export interface ExemptionRequest {
  id: string;
  constraintId: string;
  requestedBy: string;
  requestedFor: string;  // Employee ID
  targetShifts: string[];
  justification: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
  expiresAt?: Date;
}

export interface LegalConstraint {
  id: string;
  type: 'max_consecutive_days' | 'max_weekly_hours' | 'mandatory_break' | 'night_shift_limit' | 'overtime_limit';
  roleId?: string;
  value: number;
  period: 'daily' | 'weekly' | 'monthly' | 'annual';
  isActive: boolean;
  description: string;
  penalty: number;  // Penalty weight for violations
}
```

### Notification & Integration Types

```typescript
// Notification system
export interface Notification {
  id: string;
  userId: string;
  type: 'schedule_change' | 'shift_assignment' | 'approval_request' | 'reminder' | 'violation_alert';
  title: string;
  message: string;
  data?: Record<string, any>;
  isRead: boolean;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: Date;
  scheduledFor?: Date;
  expiresAt?: Date;
}

// Reporting system
export interface ReportConfig {
  id: string;
  name: string;
  type: 'schedule_overview' | 'employee_hours' | 'coverage_analysis' | 'constraint_violations' | 'performance_metrics';
  format: 'pdf' | 'excel' | 'csv' | 'browser_edit';
  parameters: Record<string, any>;
  scheduledGeneration?: Date;
  recipients?: string[];
  template?: string;
}

export interface ReportResult {
  id: string;
  configId: string;
  generatedAt: Date;
  generatedBy: string;
  data: any[][];
  columns: string[];
  metadata: ReportMetadata;
  downloadUrl?: string;
  status: 'generating' | 'completed' | 'failed';
}

export interface ReportMetadata {
  totalRows: number;
  generationTime: number;  // milliseconds
  filters: Record<string, any>;
  summary?: Record<string, any>;
}

// Integration events
export interface IntegrationEvent {
  id: string;
  type: 'schedule_approved' | 'employee_updated' | 'hours_calculated' | 'user_created' | 'shift_assigned';
  payload: Record<string, any>;
  targetSystem?: string;
  status: 'pending' | 'sent' | 'acknowledged' | 'failed';
  createdAt: Date;
  processedAt?: Date;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
}
```

### API Response Types

```typescript
// Standard API response wrapper
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
    field?: string;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  meta?: {
    timestamp: string;
    requestId: string;
    version: string;
    processingTime: number;
  };
}

// Error types
export type ErrorCode = 
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'LOGIN_FAILED'
  | 'TOKEN_EXPIRED'
  | 'CONSTRAINT_VIOLATION'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'HIERARCHY_VIOLATION'
  | 'SCHEDULE_CONFLICT'
  | 'DATABASE_ERROR';

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, any>;
}

// Query filters
export interface EmployeeFilters {
  department?: string;
  position?: string;
  active?: boolean;
  hierarchyPath?: string;
  skills?: string[];
}

export interface ShiftFilters {
  startDate?: string;
  endDate?: string;
  department?: string;
  type?: 'regular' | 'special';
  status?: 'draft' | 'published' | 'archived';
}

export interface AssignmentFilters {
  employeeId?: string;
  shiftId?: string;
  status?: 'pending' | 'approved' | 'rejected';
  dateRange?: { start: string; end: string };
}
```

---

## 5. Complete Database Schema

### Core Tables with Full Specifications

```sql
-- Users table with complete hierarchy support
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'employee') NOT NULL,
  employee_id VARCHAR(50) NULL,
  parent_supervisor INT NULL,
  hierarchy_level INT NOT NULL DEFAULT 0,
  hierarchy_path VARCHAR(500) NOT NULL,
  max_subordinate_level INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT NULL,
  last_login TIMESTAMP NULL,
  reset_token VARCHAR(255) NULL,
  reset_token_expiry TIMESTAMP NULL,
  notification_token VARCHAR(500) NULL,
  is_active BOOLEAN DEFAULT TRUE,
  
  INDEX idx_username (username),
  INDEX idx_email (email),
  INDEX idx_hierarchy_path (hierarchy_path),
  INDEX idx_parent (parent_supervisor),
  INDEX idx_level (hierarchy_level),
  INDEX idx_active (is_active),
  INDEX idx_employee_id (employee_id),
  
  FOREIGN KEY (parent_supervisor) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- User permissions for fine-grained access control
CREATE TABLE user_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  resource VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  scope VARCHAR(50) NOT NULL,
  conditions JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_permission (user_id, resource, action, scope),
  INDEX idx_user (user_id),
  INDEX idx_resource (resource),
  INDEX idx_action (action),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Delegated authorities
CREATE TABLE delegated_authorities (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('forced_assignment', 'availability_override', 'constraint_exception') NOT NULL,
  target_employee_id VARCHAR(50) NULL,
  target_shift_id VARCHAR(36) NULL,
  target_time_start DATETIME NULL,
  target_time_end DATETIME NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at DATETIME NULL,
  delegated_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_active (is_active),
  INDEX idx_expires (expires_at),
  INDEX idx_delegated_by (delegated_by),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (delegated_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Employees table with comprehensive work patterns
CREATE TABLE employees (
  employee_id VARCHAR(50) PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  position VARCHAR(100) NOT NULL,
  department VARCHAR(100) NOT NULL,
  hire_date DATE NOT NULL,
  contract_from DATE NOT NULL,
  contract_to DATE NOT NULL,
  work_patterns JSON NOT NULL,
  skills JSON NOT NULL,
  preferences JSON NOT NULL,
  emergency_contact JSON NOT NULL,
  primary_unit VARCHAR(255) NOT NULL,
  secondary_units JSON NULL,
  primary_supervisor INT NOT NULL,
  secondary_supervisors JSON NULL,
  hierarchy_path VARCHAR(500) NOT NULL,
  rest_hours INT NULL,
  target_hours JSON NULL,
  roles JSON NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_email (email),
  INDEX idx_department (department),
  INDEX idx_position (position),
  INDEX idx_active (is_active),
  INDEX idx_primary_unit (primary_unit),
  INDEX idx_hierarchy_path (hierarchy_path),
  INDEX idx_name (first_name, last_name),
  
  FOREIGN KEY (primary_supervisor) REFERENCES users(id) ON DELETE RESTRICT
);

-- Employee skills (normalized)
CREATE TABLE employee_skills (
  employee_id VARCHAR(50) NOT NULL,
  skill_name VARCHAR(100) NOT NULL,
  proficiency_level INT DEFAULT 1,  -- 1-5 scale
  certified BOOLEAN DEFAULT FALSE,
  certification_date DATE NULL,
  expires_at DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (employee_id, skill_name),
  INDEX idx_skill (skill_name),
  INDEX idx_certified (certified),
  
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);

-- Shifts table with comprehensive shift management
CREATE TABLE shifts (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  date DATE NOT NULL,
  department VARCHAR(100) NOT NULL,
  position VARCHAR(100) NOT NULL,
  required_skills JSON NOT NULL,
  minimum_staff INT NOT NULL,
  maximum_staff INT NOT NULL,
  type ENUM('regular', 'special') DEFAULT 'regular',
  special_type ENUM('on_call', 'overtime', 'emergency', 'holiday') NULL,
  priority INT DEFAULT 1,
  location VARCHAR(255) NULL,
  description TEXT NULL,
  status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
  roles_required JSON NOT NULL,  -- {role: count} mapping
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_date (date),
  INDEX idx_department (department),
  INDEX idx_position (position),
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_priority (priority),
  INDEX idx_time_range (date, start_time, end_time),
  INDEX idx_created_by (created_by),
  
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Shift role requirements (normalized)
CREATE TABLE shift_role_requirements (
  shift_id VARCHAR(36) NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  min_required INT NOT NULL,
  max_allowed INT NULL,
  priority_level INT DEFAULT 1,
  
  PRIMARY KEY (shift_id, role_name),
  INDEX idx_role (role_name),
  INDEX idx_priority (priority_level),
  
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE
);

-- Shift assignments
CREATE TABLE shift_assignments (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  shift_id VARCHAR(36) NOT NULL,
  role VARCHAR(100) NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  rejected_reason TEXT NULL,
  notes TEXT NULL,
  
  UNIQUE KEY unique_assignment (employee_id, shift_id),
  INDEX idx_employee (employee_id),
  INDEX idx_shift (shift_id),
  INDEX idx_status (status),
  INDEX idx_role (role),
  INDEX idx_approved_by (approved_by),
  
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Forced assignments (management directives)
CREATE TABLE forced_assignments (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(50) NOT NULL,
  shift_id VARCHAR(36) NOT NULL,
  created_by INT NOT NULL,
  justification TEXT NOT NULL,
  priority ENUM('emergency', 'operational', 'administrative') NOT NULL,
  overrides JSON NULL,  -- List of constraint IDs this overrides
  can_be_exempted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_employee (employee_id),
  INDEX idx_shift (shift_id),
  INDEX idx_priority (priority),
  INDEX idx_created_by (created_by),
  
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Hierarchical constraints
CREATE TABLE hierarchical_constraints (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  created_by INT NOT NULL,
  hierarchy_level INT NOT NULL,
  applies_to ENUM('employee', 'unit', 'role', 'hierarchy_branch') NOT NULL,
  target_scope JSON NOT NULL,
  parameters JSON NOT NULL,
  inheritance_rule ENUM('cascade_down', 'direct_only', 'skip_one_level') NOT NULL,
  exemption_policy ENUM('no_exemptions', 'same_level_approval', 'higher_level_approval') NOT NULL,
  priority INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  
  INDEX idx_type (type),
  INDEX idx_created_by (created_by),
  INDEX idx_level (hierarchy_level),
  INDEX idx_active (is_active),
  INDEX idx_priority (priority),
  INDEX idx_expires (expires_at),
  
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Exemption requests
CREATE TABLE exemption_requests (
  id VARCHAR(36) PRIMARY KEY,
  constraint_id VARCHAR(36) NOT NULL,
  requested_by INT NOT NULL,
  requested_for VARCHAR(50) NOT NULL,  -- Employee ID
  target_shifts JSON NOT NULL,  -- Array of shift IDs
  justification TEXT NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL,
  review_notes TEXT NULL,
  expires_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_constraint (constraint_id),
  INDEX idx_requested_by (requested_by),
  INDEX idx_requested_for (requested_for),
  INDEX idx_status (status),
  INDEX idx_reviewed_by (reviewed_by),
  
  FOREIGN KEY (constraint_id) REFERENCES hierarchical_constraints(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_for) REFERENCES employees(employee_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Legal constraints (union/labor law requirements)
CREATE TABLE legal_constraints (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  role_id VARCHAR(100) NULL,  -- NULL means applies to all
  value_numeric DECIMAL(10,2) NOT NULL,
  value_text VARCHAR(500) NULL,
  period ENUM('daily', 'weekly', 'monthly', 'annual') NOT NULL,
  penalty_weight DECIMAL(5,2) DEFAULT 1.0,
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_type (type),
  INDEX idx_role (role_id),
  INDEX idx_active (is_active),
  INDEX idx_period (period)
);

-- Schedule results for history and audit
CREATE TABLE schedule_results (
  id VARCHAR(36) PRIMARY KEY,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by INT NOT NULL,
  parameters JSON NOT NULL,
  stats JSON NOT NULL,
  assignments JSON NOT NULL,
  unassigned_shifts JSON NULL,
  constraint_violations JSON NULL,
  status ENUM('draft', 'approved', 'active', 'archived') DEFAULT 'draft',
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  version_number INT DEFAULT 1,
  
  INDEX idx_generated_at (generated_at),
  INDEX idx_generated_by (generated_by),
  INDEX idx_status (status),
  INDEX idx_approved_by (approved_by),
  INDEX idx_version (version_number),
  
  FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Notifications
CREATE TABLE notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSON NULL,
  priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  
  INDEX idx_user (user_id),
  INDEX idx_type (type),
  INDEX idx_priority (priority),
  INDEX idx_read (is_read),
  INDEX idx_created_at (created_at),
  INDEX idx_scheduled (scheduled_for),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Reports configuration
CREATE TABLE report_configs (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  format ENUM('pdf', 'excel', 'csv', 'browser_edit') NOT NULL,
  parameters JSON NOT NULL,
  template TEXT NULL,
  scheduled_generation TIMESTAMP NULL,
  recipients JSON NULL,  -- Array of email addresses
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  
  INDEX idx_type (type),
  INDEX idx_format (format),
  INDEX idx_created_by (created_by),
  INDEX idx_active (is_active),
  INDEX idx_scheduled (scheduled_generation),
  
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Report results
CREATE TABLE report_results (
  id VARCHAR(36) PRIMARY KEY,
  config_id VARCHAR(36) NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by INT NOT NULL,
  data JSON NOT NULL,
  columns JSON NOT NULL,
  metadata JSON NOT NULL,
  download_url VARCHAR(500) NULL,
  status ENUM('generating', 'completed', 'failed') DEFAULT 'generating',
  error_message TEXT NULL,
  file_size BIGINT NULL,
  
  INDEX idx_config (config_id),
  INDEX idx_generated_at (generated_at),
  INDEX idx_generated_by (generated_by),
  INDEX idx_status (status),
  
  FOREIGN KEY (config_id) REFERENCES report_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Integration events for external systems
CREATE TABLE integration_events (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  target_system VARCHAR(100) NULL,
  status ENUM('pending', 'sent', 'acknowledged', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  error_message TEXT NULL,
  
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_target (target_system),
  INDEX idx_created_at (created_at),
  INDEX idx_retry (retry_count)
);

-- Hierarchy change audit log
CREATE TABLE hierarchy_changes (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  change_type ENUM('created', 'moved', 'permissions_changed', 'authority_delegated', 'role_changed') NOT NULL,
  old_parent INT NULL,
  new_parent INT NULL,
  old_role VARCHAR(50) NULL,
  new_role VARCHAR(50) NULL,
  changed_by INT NOT NULL,
  change_reason TEXT,
  change_details JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user (user_id),
  INDEX idx_changed_by (changed_by),
  INDEX idx_created_at (created_at),
  INDEX idx_change_type (change_type),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (old_parent) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (new_parent) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- System audit log
CREATE TABLE system_audit_log (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(36) NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  success BOOLEAN NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user (user_id),
  INDEX idx_action (action),
  INDEX idx_resource (resource_type, resource_id),
  INDEX idx_created_at (created_at),
  INDEX idx_success (success),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

### Database Views for Complex Queries

```sql
-- Materialized view for hierarchy queries
CREATE VIEW hierarchy_tree AS
WITH RECURSIVE hierarchy_cte AS (
  SELECT 
    id,
    username,
    first_name,
    last_name,
    parent_supervisor,
    hierarchy_level,
    hierarchy_path,
    CAST(id AS CHAR(500)) as path
  FROM users 
  WHERE parent_supervisor IS NULL
  
  UNION ALL
  
  SELECT 
    u.id,
    u.username,
    u.first_name,
    u.last_name,
    u.parent_supervisor,
    u.hierarchy_level,
    u.hierarchy_path,
    CONCAT(h.path, '.', u.id)
  FROM users u
  INNER JOIN hierarchy_cte h ON u.parent_supervisor = h.id
)
SELECT * FROM hierarchy_cte;

-- View for employee full details
CREATE VIEW employee_details AS
SELECT 
  e.employee_id,
  e.first_name,
  e.last_name,
  e.email,
  e.phone,
  e.position,
  e.department,
  e.hire_date,
  e.contract_from,
  e.contract_to,
  e.is_active,
  u.username as supervisor_username,
  u.first_name as supervisor_first_name,
  u.last_name as supervisor_last_name,
  GROUP_CONCAT(es.skill_name) as skills_list
FROM employees e
LEFT JOIN users u ON e.primary_supervisor = u.id
LEFT JOIN employee_skills es ON e.employee_id = es.employee_id
GROUP BY e.employee_id;

-- View for shift assignments with details
CREATE VIEW assignment_details AS
SELECT 
  sa.id,
  sa.employee_id,
  sa.shift_id,
  sa.role,
  sa.status,
  sa.assigned_at,
  sa.approved_at,
  e.first_name as employee_first_name,
  e.last_name as employee_last_name,
  s.name as shift_name,
  s.date as shift_date,
  s.start_time,
  s.end_time,
  s.department,
  approver.first_name as approved_by_first_name,
  approver.last_name as approved_by_last_name
FROM shift_assignments sa
JOIN employees e ON sa.employee_id = e.employee_id
JOIN shifts s ON sa.shift_id = s.id
LEFT JOIN users approver ON sa.approved_by = approver.id;
```

---

## 6. Complete API Specification

### Authentication & Authorization API

#### POST /api/auth/login
**Description**: Authenticate user and obtain JWT token

**Request**:
```typescript
{
  username?: string;  // Either username or email required
  email?: string;
  password: string;
  rememberMe?: boolean;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    user: Omit<User, 'passwordHash' | 'salt'>;
    token: string;
    hierarchyContext: HierarchyContext;
  };
  meta: {
    timestamp: string;
    requestId: string;
    expiresIn: number;  // Token expiry in seconds
  };
}
```

**Status Codes**:
- `200`: Login successful
- `400`: Validation error (missing fields)
- `401`: Invalid credentials
- `403`: Account disabled
- `429`: Too many login attempts

#### GET /api/auth/verify
**Description**: Verify JWT token validity

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Omit<User, 'passwordHash' | 'salt'>;
}
```

#### POST /api/auth/refresh
**Description**: Refresh JWT token

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: {
    user: Omit<User, 'passwordHash' | 'salt'>;
    token: string;
    expiresIn: number;
  };
}
```

#### POST /api/auth/logout
**Description**: Logout user (client-side token invalidation)

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  message: string;
}
```

### User Management API

#### GET /api/users
**Description**: List users with hierarchy filtering

**Query Parameters**:
- `page: number` (default: 1)
- `limit: number` (default: 20, max: 100)
- `search: string` (search in name/email)
- `role: 'admin' | 'manager' | 'employee'`
- `department: string`
- `active: boolean`
- `hierarchyLevel: number`
- `sortBy: string` (default: 'firstName')
- `sortOrder: 'asc' | 'desc'` (default: 'asc')

**Response**:
```typescript
{
  success: boolean;
  data: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

#### GET /api/users/:id
**Description**: Get user by ID

**Response**:
```typescript
{
  success: boolean;
  data: User;
}
```

#### POST /api/users
**Description**: Create new user

**Request**:
```typescript
{
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'employee';
  employeeId?: string;
  parentSupervisor?: number;
  maxSubordinateLevel?: number;
  permissions?: Permission[];
}
```

**Response**:
```typescript
{
  success: boolean;
  data: User;
}
```

#### PUT /api/users/:id
**Description**: Update user

**Request**:
```typescript
{
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: 'admin' | 'manager' | 'employee';
  parentSupervisor?: number;
  isActive?: boolean;
  permissions?: Permission[];
}
```

**Response**:
```typescript
{
  success: boolean;
  data: User;
}
```

#### DELETE /api/users/:id
**Description**: Deactivate user

**Response**:
```typescript
{
  success: boolean;
  message: string;
}
```

### Employee Management API

#### GET /api/employees
**Description**: List employees with filtering

**Query Parameters**:
- `page: number`
- `limit: number`
- `search: string`
- `department: string`
- `position: string`
- `active: boolean`
- `hierarchyPath: string`
- `skills: string[]`
- `contractStatus: 'active' | 'expiring' | 'expired'`

**Response**:
```typescript
{
  success: boolean;
  data: Employee[];
  pagination: PaginationResponse;
}
```

#### GET /api/employees/:id
**Description**: Get employee by ID

**Response**:
```typescript
{
  success: boolean;
  data: Employee & {
    assignments: Assignment[];
    preferences: EmployeePreferences;
    stats: {
      totalHoursThisMonth: number;
      assignmentsThisMonth: number;
      preferenceSatisfactionRate: number;
    };
  };
}
```

#### POST /api/employees
**Description**: Create new employee

**Request**:
```typescript
{
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  hireDate: string;
  contractFrom: string;
  contractTo: string;
  workPatterns: WorkPattern;
  skills: string[];
  emergencyContact: EmergencyContact;
  primarySupervisor: number;
}
```

#### PUT /api/employees/:id
**Description**: Update employee

**Request**: `Partial<Employee>`

#### DELETE /api/employees/:id
**Description**: Deactivate employee

#### GET /api/employees/:id/availability
**Description**: Get employee availability for date range

**Query Parameters**:
- `startDate: string`
- `endDate: string`

**Response**:
```typescript
{
  success: boolean;
  data: {
    availableSlots: TimeSlot[];
    unavailableSlots: TimeSlot[];
    preferences: EmployeePreferences;
    constraints: HierarchicalConstraint[];
  };
}
```

#### POST /api/employees/:id/preferences
**Description**: Update employee preferences

**Request**:
```typescript
{
  preferredDepartments: string[];
  avoidNightShifts: boolean;
  flexibleSchedule: boolean;
  maxConsecutiveDays: number;
  preferredDaysOff: string[];
  notes?: string;
}
```

### Shift Management API

#### GET /api/shifts/templates
**Description**: List all shift templates

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: ShiftTemplate[];
}
```

#### GET /api/shifts/templates/:id
**Description**: Get specific shift template

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: ShiftTemplate;
}
```

#### POST /api/shifts/templates
**Description**: Create new shift template (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  name: string;
  startTime: string;
  endTime: string;
  department: string;
  position: string;
  requiredStaff: number;
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: ShiftTemplate;
}
```

#### PUT /api/shifts/templates/:id
**Description**: Update shift template (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  name?: string;
  startTime?: string;
  endTime?: string;
  department?: string;
  position?: string;
  requiredStaff?: number;
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: ShiftTemplate;
}
```

#### DELETE /api/shifts/templates/:id
**Description**: Delete shift template (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  message: string;
}
```

#### GET /api/shifts
**Description**: List all shifts with optional filters

**Query Parameters**:
- `scheduleId: string` - Filter by schedule
- `departmentId: string` - Filter by department
- `date: string` - Filter by specific date
- `startDate: string` - Filter by start date range
- `endDate: string` - Filter by end date range

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Shift[];
}
```

#### GET /api/shifts/:id
**Description**: Get specific shift details

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Shift;
}
```

#### POST /api/shifts
**Description**: Create new shift (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  templateId?: string;
  scheduleId: string;
  date: string;
  startTime: string;
  endTime: string;
  department: string;
  position: string;
  requiredStaff: number;
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Shift;
}
```

#### PUT /api/shifts/:id
**Description**: Update shift (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  date?: string;
  startTime?: string;
  endTime?: string;
  department?: string;
  position?: string;
  requiredStaff?: number;
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Shift;
}
```

#### DELETE /api/shifts/:id
**Description**: Delete shift (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  message: string;
}
```

#### GET /api/shifts/schedule/:scheduleId
**Description**: Get all shifts for a specific schedule

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Shift[];
}
```

#### GET /api/shifts/department/:departmentId
**Description**: Get all shifts for a specific department

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Shift[];
}
```

### Schedule Management API

#### GET /api/schedules
**Description**: List all schedules with optional filters

**Query Parameters**:
- `status: string` - Filter by schedule status
- `department: string` - Filter by department
- `startDate: string` - Filter by start date
- `endDate: string` - Filter by end date

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Schedule[];
}
```

#### GET /api/schedules/:id
**Description**: Get specific schedule details

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Schedule;
}
```

#### GET /api/schedules/:id/shifts
**Description**: Get all shifts for a specific schedule

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Shift[];
}
```

#### POST /api/schedules
**Description**: Create new schedule (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  name: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'active' | 'published' | 'archived';
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Schedule;
}
```

#### PUT /api/schedules/:id
**Description**: Update schedule (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: 'draft' | 'active' | 'published' | 'archived';
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Schedule;
}
```

#### DELETE /api/schedules/:id
**Description**: Delete schedule (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  message: string;
}
```

#### GET /api/schedules/department/:departmentId
**Description**: Get schedules for specific department

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Schedule[];
}
```

#### GET /api/schedules/user/:userId
**Description**: Get schedules for specific user

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Schedule[];
}
```

#### POST /api/schedules/:id/duplicate
**Description**: Duplicate an existing schedule (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  name: string;
  startDate: string;
  endDate: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Schedule;
}
```

### Assignment Management API

#### GET /api/assignments
**Description**: List all assignments with optional filters

**Query Parameters**:
- `employeeId: string` - Filter by employee ID
- `shiftId: string` - Filter by shift ID
- `status: string` - Filter by assignment status
- `startDate: string` - Filter by start date
- `endDate: string` - Filter by end date
- `department: string` - Filter by department

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Assignment[];
}
```

#### GET /api/assignments/:id
**Description**: Get specific assignment details

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Assignment;
}
```

#### POST /api/assignments
**Description**: Create new assignment (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  employeeId: string;
  shiftId: string;
  role?: string;
  notes?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Assignment;
}
```

#### PUT /api/assignments/:id
**Description**: Update assignment (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  employeeId?: string;
  shiftId?: string;
  role?: string;
  notes?: string;
  status?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: Assignment;
}
```

#### DELETE /api/assignments/:id
**Description**: Delete assignment (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  message: string;
}
```

#### GET /api/assignments/user/:userId
**Description**: Get assignments for specific user

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Assignment[];
}
```

#### GET /api/assignments/shift/:shiftId
**Description**: Get assignments for specific shift

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Assignment[];
}
```

#### GET /api/assignments/department/:departmentId
**Description**: Get assignments for specific department

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: Assignment[];
}
```

#### POST /api/assignments/bulk
**Description**: Create multiple assignments in bulk (admin/manager only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  assignments: {
    employeeId: string;
    shiftId: string;
    role?: string;
    notes?: string;
  }[];
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    created: Assignment[];
    failed: {
      index: number;
      error: string;
    }[];
  };
}
```

#### GET /api/assignments/shift/:shiftId/available-employees
**Description**: Get available employees for a specific shift

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: {
    employeeId: string;
    firstName: string;
    lastName: string;
    role: string;
    available: boolean;
    conflicts?: string[];
  }[];
}
```

### System Settings API

#### GET /api/settings
**Description**: Get all system settings

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: SystemSetting[];
}
```

#### GET /api/settings/category/:category
**Description**: Get settings by category

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: SystemSetting[];
}
```

#### GET /api/settings/:category/:key
**Description**: Get specific setting

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: SystemSetting;
}
```

#### PUT /api/settings/:category/:key
**Description**: Update system setting (admin only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  value: string;
  description?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: SystemSetting;
}
```

#### POST /api/settings/:category/:key/reset
**Description**: Reset setting to default (admin only)

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: SystemSetting;
}
```

#### GET /api/settings/currency
**Description**: Get currency settings

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: {
    code: string;
    symbol: string;
    name: string;
  };
}
```

#### PUT /api/settings/currency
**Description**: Update currency settings (admin only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  currency: 'EUR' | 'USD';
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    code: string;
    symbol: string;
    name: string;
  };
}
```

#### GET /api/settings/time-period
**Description**: Get time period settings

**Headers**: `Authorization: Bearer <token>`

**Response**:
```typescript
{
  success: boolean;
  data: {
    defaultPeriod: 'weekly' | 'monthly';
  };
}
```

#### PUT /api/settings/time-period
**Description**: Update time period settings (admin only)

**Headers**: `Authorization: Bearer <token>`

**Request**:
```typescript
{
  period: 'weekly' | 'monthly';
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    defaultPeriod: 'weekly' | 'monthly';
  };
}
```

### Health Check API

#### GET /api/health/health
**Description**: Basic health check

**Response**:
```typescript
{
  success: boolean;
  data: {
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
  };
}
```

#### GET /api/health/ready
**Description**: Readiness check for load balancers

**Response**:
```typescript
{
  success: boolean;
  data: {
    status: 'ready' | 'not_ready';
    services: {
      database: 'connected' | 'disconnected';
      redis?: 'connected' | 'disconnected';
    };
  };
}
```

### Schedule Generation API

#### POST /api/schedules/generate
**Description**: Generate schedule using optimization engine

**Request**:
```typescript
{
  parameters: ScheduleParameters;
  dateRange: {
    start: string;
    end: string;
  };
  constraints?: HierarchicalConstraint[];
  forcedAssignments?: ForcedAssignment[];
  exemptions?: ExemptionRequest[];
  overrides?: {
    employeeId: string;
    shiftId: string;
    action: 'force' | 'forbid';
  }[];
}
```

**Response**:
```typescript
{
  success: boolean;
  data: ScheduleResult;
  meta: {
    processingTime: number;
    optimizationDetails: {
      iterations: number;
      objectiveValue: number;
      convergence: boolean;
    };
  };
}
```

#### GET /api/schedules/:id
**Description**: Get schedule result by ID

#### POST /api/schedules/:id/approve
**Description**: Approve generated schedule

**Request**:
```typescript
{
  notes?: string;
  effectiveDate: string;
}
```

#### POST /api/schedules/whatif
**Description**: Run what-if scenario

**Request**:
```typescript
{
  baseScheduleId: string;
  changes: {
    type: 'add' | 'remove' | 'modify';
    assignment: Assignment;
  }[];
  parameters: ScheduleParameters;
}
```

### Constraint Management API

#### GET /api/constraints
**Description**: List hierarchical constraints

**Query Parameters**:
- `type: string`
- `hierarchyLevel: number`
- `active: boolean`
- `createdBy: number`

#### POST /api/constraints
**Description**: Create hierarchical constraint

**Request**:
```typescript
{
  type: string;
  appliesTo: 'employee' | 'unit' | 'role' | 'hierarchy_branch';
  targetScope: string[];
  parameters: Record<string, any>;
  inheritanceRule: 'cascade_down' | 'direct_only' | 'skip_one_level';
  exemptionPolicy: 'no_exemptions' | 'same_level_approval' | 'higher_level_approval';
  priority: number;
  expiresAt?: string;
}
```

#### GET /api/constraints/legal
**Description**: List legal/union constraints

#### POST /api/constraints/legal
**Description**: Create legal constraint

#### POST /api/constraints/:id/exemptions
**Description**: Request exemption from constraint

**Request**:
```typescript
{
  requestedFor: string;  // Employee ID
  targetShifts: string[];
  justification: string;
  expiresAt?: string;
}
```

### Reporting API

#### GET /api/reports/types
**Description**: List available report types

**Response**:
```typescript
{
  success: boolean;
  data: {
    type: string;
    name: string;
    description: string;
    parameters: {
      name: string;
      type: 'string' | 'number' | 'date' | 'boolean';
      required: boolean;
      options?: string[];
    }[];
    formats: ('pdf' | 'excel' | 'csv' | 'browser_edit')[];
  }[];
}
```

#### POST /api/reports/generate
**Description**: Generate report

**Request**:
```typescript
{
  type: string;
  name: string;
  format: 'pdf' | 'excel' | 'csv' | 'browser_edit';
  parameters: Record<string, any>;
  recipients?: string[];
  schedule?: {
    frequency: 'once' | 'daily' | 'weekly' | 'monthly';
    startDate: string;
    endDate?: string;
  };
}
```

#### GET /api/reports/:id
**Description**: Get report result

#### GET /api/reports/:id/download
**Description**: Download report file

#### GET /api/reports/:id/edit
**Description**: Get editable report data

**Response**:
```typescript
{
  success: boolean;
  data: {
    data: any[][];
    columns: string[];
    metadata: ReportMetadata;
    editableColumns: string[];
  };
}
```

#### PUT /api/reports/:id/save
**Description**: Save edited report data

### Notification API

#### GET /api/notifications
**Description**: Get user notifications

**Query Parameters**:
- `unreadOnly: boolean`
- `type: string`
- `limit: number`

#### POST /api/notifications/send
**Description**: Send notification

**Request**:
```typescript
{
  userIds: number[];
  title: string;
  message: string;
  type: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  data?: Record<string, any>;
  scheduledFor?: string;
}
```

#### PUT /api/notifications/:id/read
**Description**: Mark notification as read

#### POST /api/notifications/register-token
**Description**: Register FCM token for push notifications

**Request**:
```typescript
{
  token: string;
  platform: 'ios' | 'android' | 'web';
}
```

### Health & System API

#### GET /api/health
**Description**: System health check

**Response**:
```typescript
{
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: 'connected' | 'disconnected' | 'slow';
    solver: 'available' | 'unavailable';
    notifications: 'enabled' | 'disabled';
  };
  metrics: {
    memory_usage: number;
    cpu_usage: number;
    active_connections: number;
    request_rate: number;
  };
}
```

#### GET /api/ready
**Description**: Readiness check for load balancers

#### GET /api/metrics
**Description**: Prometheus-compatible metrics endpoint

#### GET /api/version
**Description**: API version information

### Integration API

#### POST /api/integrations/webhook
**Description**: Receive external system webhooks

#### GET /api/integrations/events
**Description**: List integration events

#### POST /api/integrations/sync
**Description**: Trigger manual sync with external system

**Request**:
```typescript
{
  system: string;
  syncType: 'full' | 'incremental';
  resources?: string[];
}
```

### Error Handling

All API endpoints follow standard error response format:

```typescript
{
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, any>;
    field?: string;  // For validation errors
    trace?: string;  // Only in development
  };
  meta: {
    timestamp: string;
    requestId: string;
  };
}
```

### Rate Limiting

- **Authentication endpoints**: 5 requests/minute
- **Read operations**: 100 requests/minute
- **Write operations**: 30 requests/minute
- **Report generation**: 5 requests/minute
- **Bulk operations**: 10 requests/minute

### Pagination

Standard pagination for list endpoints:

```typescript
{
  page: number;        // Current page (1-based)
  limit: number;       // Items per page
  total: number;       // Total items
  pages: number;       // Total pages
  hasNext: boolean;    // Has next page
  hasPrev: boolean;    // Has previous page
}
```

Default limit: 20, Maximum limit: 100

---

## 7. Backend Implementation Details

### Large-Scale Performance Targets
- **100+ employees**: Supported with current architecture
- **500+ employees**: Requires optimization solver implementation
- **1000+ shifts/month**: Database indexing strategy implemented
- **Memory usage**: < 500MB baseline for core operations
- **Incremental solving**: Foundation for modular optimization

### Project Implementation Status

**Fully Implemented:**
- User authentication with JWT tokens
- Database schema with complete indexes
- Basic CRUD operations for employees, shifts, assignments
- Configuration management system
- Logging and error handling
- API middleware (CORS, compression, rate limiting)
- TypeScript type definitions

**In Development:**
- Advanced schedule optimization algorithms
- Hierarchical constraint system
- Permission delegation framework
- Real-time collaboration features

**Future Enhancements:**
- Integration with third-party constraint solvers (OR-Tools, CPLEX)
- Advanced analytics and reporting
- Multi-language support
- Mobile application

#### Algorithm Selection
```typescript
interface SolverConfig {
  engine: 'javascript' | 'or-tools' | 'cplex' | 'gurobi'; // JavaScript is current implementation
  timeout: number; // seconds - default 300
  threads?: number; // For parallel solvers
  memoryLimit?: number; // MB
  heuristics?: 'fast' | 'balanced' | 'thorough';
  preprocessingLevel: 'minimal' | 'standard' | 'aggressive';
}

interface OptimizationProgress {
  phase: 'preprocessing' | 'solving' | 'postprocessing';
  progress: number; // 0-100
  currentObjective?: number;
  bestBound?: number;
  elapsedTime: number;
  estimatedRemaining?: number;
}
```

**Note**: The current JavaScript implementation provides a foundation for schedule optimization. Production deployments may integrate advanced constraint solvers like OR-Tools or CPLEX for enhanced performance with large datasets.

#### Database Optimization
- **Materialized paths**: Efficient hierarchy queries O(1)
- **Indexes**: Strategic indexing for common query patterns
- **Connection pooling**: Optimal database connection management
- **Query optimization**: Minimize N+1 queries, use batch operations

#### Caching Strategy
- **User permissions**: Cache permission calculations
- **Hierarchy paths**: Cache organizational structure
- **Schedule results**: Cache recent optimization results
- **Static data**: Cache employee skills, roles, departments

### Service Layer Architecture

The backend is organized with a clear separation of concerns:

**User Service** - Authentication and user management
- User creation with role-based access control
- Login with JWT token generation
- Password hashing with bcrypt
- User permissions management
- Hierarchy validation

**Employee Service** - Employee lifecycle management
- CRUD operations with complete validation
- Skills management with proficiency levels
- Department and supervisor assignment
- Availability tracking
- Contract period management

**Shift Service** - Shift management and templates
- Shift template management for recurring patterns
- Shift creation with role requirements
- Skill requirements management
- Shift publication workflow
- Status tracking (draft, published, archived)

**Assignment Service** - Employee-shift assignments
- Assignment creation and validation
- Approval workflow
- Conflict detection
- Status management
- Bulk operations support

**Schedule Service** - Schedule generation and management
- Schedule creation and storage
- Integration with optimization engine
- Result persistence
- Version tracking
- Status lifecycle

**System Settings Service** - Configuration management
- Configurable system parameters
- Currency and time period settings
- Reporting configuration
- Notification preferences

All services follow these patterns:
- Constructor injection of database pool
- Async/await for database operations
- Type-safe return values
- Comprehensive error handling
- Parameterized queries to prevent SQL injection

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const user = credentials.username 
      ? await this.findByUsername(credentials.username)
      : await this.findByEmail(credentials.email!);

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Update last login
    await database.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        role: user.role,
        hierarchyLevel: user.hierarchyLevel,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      },
      config.jwt.secret
    );

    // Load permissions and hierarchy context
    const permissions = await this.loadUserPermissions(user.id);
    const hierarchyContext = await this.buildHierarchyContext(user);

    const { passwordHash, salt, ...userWithoutPassword } = user;

    return {
      user: { ...userWithoutPassword, permissions },
      token,
      hierarchyContext
    };
  }

  private async validateHierarchyLevel(parentId?: number, role?: string): Promise<void> {
    if (!parentId) return; // Root user

    const parent = await this.findById(parentId);
    if (!parent) {
      throw new Error('Parent supervisor not found');
    }

    // Check if parent can create users at this level
    const childLevel = parent.hierarchyLevel + 1;
    if (parent.maxSubordinateLevel !== null && childLevel > parent.maxSubordinateLevel) {
      throw new Error('Parent cannot create users at this hierarchy level');
    }

    // Role-based hierarchy validation
    if (role === 'admin' && parent.role !== 'admin') {
      throw new Error('Only admins can create admin users');
    }
  }

  private async generateHierarchyPath(parentId?: number): Promise<string> {
    if (!parentId) return '0'; // Root path

    const parent = await this.findById(parentId);
    if (!parent) {
      throw new Error('Parent supervisor not found');
    }

    return `${parent.hierarchyPath}.${parentId}`;
  }

  private async loadUserPermissions(userId: number): Promise<Permission[]> {
    const query = `
      SELECT resource, action, scope, conditions
      FROM user_permissions
      WHERE user_id = ?
    `;
    
    const rows = await database.query(query, [userId]);
    return rows.map(row => ({
      resource: row.resource,
      action: row.action,
      scope: row.scope,
      conditions: row.conditions ? JSON.parse(row.conditions) : undefined
    }));
  }

  private async buildHierarchyContext(user: User): Promise<HierarchyContext> {
    // Get subordinates count
    const subordinatesQuery = `
      SELECT COUNT(*) as count
      FROM users
      WHERE hierarchy_path LIKE ?
      AND id != ?
    `;
    const subordinatesResult = await database.query(subordinatesQuery, [
      `${user.hierarchyPath}.%`,
      user.id
    ]);

    // Get accessible units
    const unitsQuery = `
      SELECT DISTINCT primary_unit
      FROM employees
      WHERE primary_supervisor = ?
      OR hierarchy_path LIKE ?
    `;
    const unitsResult = await database.query(unitsQuery, [
      user.id,
      `${user.hierarchyPath}.%`
    ]);

    return {
      level: user.hierarchyLevel,
      canCreateUsers: user.role === 'admin' || user.role === 'manager',
      maxSubordinateLevel: user.maxSubordinateLevel || user.hierarchyLevel + 2,
      accessibleUnits: unitsResult.map(row => row.primary_unit),
      subordinateCount: subordinatesResult[0]?.count || 0,
      delegatedAuthorities: await this.loadDelegatedAuthorities(user.id)
    };
  }
}

// EmployeeService - Core employee management
export class EmployeeService {
  async createEmployee(employeeData: Employee): Promise<Employee> {
    // Validate supervisor exists and has authority
    await this.validateSupervisorAuthority(employeeData.primarySupervisor, employeeData.department);
    
    // Generate employee ID if not provided
    if (!employeeData.employeeId) {
      employeeData.employeeId = await this.generateEmployeeId(employeeData.department);
    }

    const query = `
      INSERT INTO employees (
        employee_id, first_name, last_name, email, phone, position, department,
        hire_date, contract_from, contract_to, work_patterns, skills,
        preferences, emergency_contact, primary_unit, primary_supervisor,
        hierarchy_path, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, NOW(), NOW())
    `;

    await database.query(query, [
      employeeData.employeeId, employeeData.firstName, employeeData.lastName,
      employeeData.email, employeeData.phone, employeeData.position,
      employeeData.department, employeeData.hireDate, employeeData.contractFrom,
      employeeData.contractTo, JSON.stringify(employeeData.workPatterns),
      JSON.stringify(employeeData.skills), JSON.stringify(employeeData.preferences),
      JSON.stringify(employeeData.emergencyContact), employeeData.primaryUnit,
      employeeData.primarySupervisor, employeeData.hierarchyPath
    ]);

    // Insert skills separately for better querying
    await this.updateEmployeeSkills(employeeData.employeeId, employeeData.skills);

    return this.findById(employeeData.employeeId);
  }

  async findWithFilters(filters: EmployeeFilters, pagination: PaginationParams): Promise<{ employees: Employee[], total: number }> {
    let whereClause = 'WHERE e.is_active = true';
    const params: any[] = [];

    // Build dynamic WHERE clause
    if (filters.department) {
      whereClause += ' AND e.department = ?';
      params.push(filters.department);
    }

    if (filters.position) {
      whereClause += ' AND e.position = ?';
      params.push(filters.position);
    }

    if (filters.hierarchyPath) {
      whereClause += ' AND e.hierarchy_path LIKE ?';
      params.push(`${filters.hierarchyPath}%`);
    }

    if (filters.skills && filters.skills.length > 0) {
      const skillsPlaceholders = filters.skills.map(() => '?').join(',');
      whereClause += ` AND e.employee_id IN (
        SELECT DISTINCT employee_id FROM employee_skills 
        WHERE skill_name IN (${skillsPlaceholders})
      )`;
      params.push(...filters.skills);
    }

    // Add search functionality
    if (pagination.search) {
      whereClause += ` AND (
        e.first_name LIKE ? OR 
        e.last_name LIKE ? OR 
        e.email LIKE ? OR
        e.employee_id LIKE ?
      )`;
      const searchTerm = `%${pagination.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total for pagination
    const countQuery = `SELECT COUNT(*) as total FROM employees e ${whereClause}`;
    const countResult = await database.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    // Build main query with sorting and pagination
    const sortBy = pagination.sortBy || 'first_name';
    const sortOrder = pagination.sortOrder || 'asc';
    const offset = (pagination.page - 1) * pagination.limit;

    const query = `
      SELECT e.*, u.first_name as supervisor_first_name, u.last_name as supervisor_last_name
      FROM employees e
      LEFT JOIN users u ON e.primary_supervisor = u.id
      ${whereClause}
      ORDER BY e.${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    params.push(pagination.limit, offset);
    const employees = await database.query(query, params);

    return {
      employees: employees.map(this.mapDatabaseRowToEmployee),
      total
    };
  }

  private async updateEmployeeSkills(employeeId: string, skills: string[]): Promise<void> {
    // Remove existing skills
    await database.query('DELETE FROM employee_skills WHERE employee_id = ?', [employeeId]);

    // Insert new skills
    if (skills.length > 0) {
      const skillsData = skills.map(skill => [employeeId, skill, 1, false]); // Default proficiency 1, not certified
      const placeholders = skillsData.map(() => '(?, ?, ?, ?)').join(', ');
      const query = `
        INSERT INTO employee_skills (employee_id, skill_name, proficiency_level, certified)
        VALUES ${placeholders}
      `;
      await database.query(query, skillsData.flat());
    }
  }
}

// ShiftService - Shift management with optimization integration
export class ShiftService {
  async createShift(shiftData: Shift): Promise<Shift> {
    // Validate shift timing and constraints
    await this.validateShiftConstraints(shiftData);
    
    const shiftId = uuidv4();
    const query = `
      INSERT INTO shifts (
        id, name, start_time, end_time, date, department, position,
        required_skills, minimum_staff, maximum_staff, type, special_type,
        priority, location, description, roles_required, status,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW(), NOW())
    `;

    await database.query(query, [
      shiftId, shiftData.name, shiftData.startTime, shiftData.endTime,
      shiftData.date, shiftData.department, shiftData.position,
      JSON.stringify(shiftData.requiredSkills), shiftData.minimumStaff,
      shiftData.maximumStaff, shiftData.type, shiftData.specialType,
      shiftData.priority, shiftData.location, shiftData.description,
      JSON.stringify(shiftData.rolesRequired), shiftData.createdBy
    ]);

    // Insert role requirements
    await this.updateShiftRoleRequirements(shiftId, shiftData.rolesRequired);

    return this.findById(shiftId);
  }

  async publishShift(shiftId: string, publishedBy: number): Promise<{ shift: Shift, notifiedEmployees: string[] }> {
    // Update shift status
    await database.query(
      'UPDATE shifts SET status = "published", updated_at = NOW() WHERE id = ?',
      [shiftId]
    );

    const shift = await this.findById(shiftId);
    if (!shift) {
      throw new Error('Shift not found');
    }

    // Find eligible employees
    const eligibleEmployees = await this.findEligibleEmployees(shift);
    
    // Send notifications
    const notifiedEmployees = await this.sendShiftNotifications(shift, eligibleEmployees);

    // Log the publication
    await this.logShiftAction(shiftId, 'published', publishedBy);

    return { shift, notifiedEmployees };
  }

  private async findEligibleEmployees(shift: Shift): Promise<Employee[]> {
    const query = `
      SELECT DISTINCT e.*
      FROM employees e
      JOIN employee_skills es ON e.employee_id = es.employee_id
      WHERE e.is_active = true
      AND e.department = ?
      AND e.contract_from <= ?
      AND e.contract_to >= ?
      AND es.skill_name IN (${shift.requiredSkills.map(() => '?').join(',')})
      AND NOT EXISTS (
        SELECT 1 FROM shift_assignments sa
        JOIN shifts s ON sa.shift_id = s.id
        WHERE sa.employee_id = e.employee_id
        AND s.date = ?
        AND (
          (s.start_time <= ? AND s.end_time > ?) OR
          (s.start_time < ? AND s.end_time >= ?)
        )
      )
    `;

    return database.query(query, [
      shift.department, shift.date, shift.date,
      ...shift.requiredSkills,
      shift.date, shift.startTime, shift.startTime,
      shift.endTime, shift.endTime
    ]);
  }
}

// ScheduleService - Complete optimization integration
export class ScheduleService {
  private optimizer: ScheduleOptimizer;
  
  constructor() {
    this.optimizer = new ScheduleOptimizer();
  }

  async generateSchedule(request: GenerateScheduleRequest): Promise<ScheduleResult> {
    // Validate request parameters
    await this.validateScheduleRequest(request);

    // Load data for optimization
    const employees = await this.loadEmployees(request.dateRange);
    const shifts = await this.loadShifts(request.dateRange);
    const constraints = await this.loadConstraints(request.constraints);
    const forcedAssignments = await this.loadForcedAssignments(request.dateRange);

    // Build optimization problem
    const problem = this.buildOptimizationProblem({
      employees,
      shifts,
      constraints,
      forcedAssignments,
      parameters: request.parameters
    });

    // Run optimization
    const optimizationResult = await this.optimizer.solve(problem);

    // Convert to schedule result
    const scheduleResult = await this.convertToScheduleResult(optimizationResult, request);

    // Save to database
    const scheduleId = await this.saveScheduleResult(scheduleResult, request.generatedBy);

    return { ...scheduleResult, id: scheduleId };
  }

  private buildOptimizationProblem(data: OptimizationData): OptimizationProblem {
    const { employees, shifts, constraints, forcedAssignments, parameters } = data;

    // Decision variables: x[i,t] = 1 if employee i assigned to shift t
    const variables = this.createDecisionVariables(employees, shifts);

    // Hard constraints
    const hardConstraints = [
      ...this.buildAvailabilityConstraints(employees, shifts),
      ...this.buildOverlapConstraints(employees, shifts),
      ...this.buildForcedAssignmentConstraints(forcedAssignments),
      ...this.buildCoverageConstraints(shifts, employees, parameters),
      ...this.buildRestRequirements(employees, shifts),
      ...this.buildHierarchicalConstraints(constraints, employees, shifts)
    ];

    // Soft constraints (objectives)
    const objectives = [
      this.buildPreferenceObjective(employees, shifts, parameters),
      this.buildFairnessObjective(employees, shifts),
      this.buildTargetHoursObjective(employees, shifts),
      this.buildStabilityObjective(shifts, parameters)
    ];

    return {
      variables,
      hardConstraints,
      objectives,
      parameters
    };
  }
}
```

### Middleware Implementation

The application uses a middleware stack for cross-cutting concerns:

**Security Middleware**
- Helmet.js for security headers
- CORS configuration with origin validation
- Rate limiting with express-rate-limit
- Request compression with gzip

**Authentication & Authorization**
- JWT token validation
- Role-based access control
- Permission checking
- Request user context injection

**Data Processing**
- Request body parsing (JSON/URL-encoded)
- File upload handling with multer
- Input validation with express-validator

**Logging & Monitoring**
- Morgan for request logging
- Winston for application logging
- Error tracking and reporting
- Performance metrics

**Error Handling**
- Global error handler with consistent error response format
- 404 handler for undefined routes
- Request validation error responses
- Stack traces in development mode only

// Authorization middleware with hierarchy validation
export const authorize = (requiredPermission: Permission) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      const hierarchyContext = req.hierarchyContext;

      if (!user || !hierarchyContext) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required'
          }
        });
      }

      // Check if user has required permission
      const hasPermission = await permissionService.checkPermission(
        user,
        requiredPermission,
        hierarchyContext
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions'
          }
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Permission check failed'
        }
      });
    }
  };
};

// Rate limiting middleware
export const rateLimiter = (options: RateLimitOptions) => {
  const limiter = rateLimit({
    windowMs: options.windowMs,
    max: options.maxRequests,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests'
      }
    },
    keyGenerator: (req) => {
      // Rate limit by user if authenticated, otherwise by IP
      return req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
    }
  });

  return limiter;
};

// Request validation middleware
export const validateRequest = (schema: joi.Schema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message,
          field: error.details[0].path.join('.')
        }
      });
    }
    next();
  };
};

// Audit logging middleware
export const auditLog = (action: string, resourceType: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Capture original res.json to log response
    const originalJson = res.json;
    let responseData: any;
    
    res.json = function(data: any) {
      responseData = data;
      return originalJson.call(this, data);
    };

    // Continue with request
    next();

    // Log after response
    res.on('finish', async () => {
      try {
        const auditEntry = {
          id: uuidv4(),
          userId: req.user?.id || null,
          action,
          resourceType,
          resourceId: req.params.id || null,
          oldValues: req.method === 'PUT' ? req.body : null,
          newValues: responseData?.success ? responseData.data : null,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          success: responseData?.success || false,
          errorMessage: !responseData?.success ? responseData?.error?.message : null,
          processingTime: Date.now() - startTime,
          createdAt: new Date()
        };

        await database.query(`
          INSERT INTO system_audit_log (
            id, user_id, action, resource_type, resource_id,
            old_values, new_values, ip_address, user_agent,
            success, error_message, processing_time, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          auditEntry.id, auditEntry.userId, auditEntry.action,
          auditEntry.resourceType, auditEntry.resourceId,
          JSON.stringify(auditEntry.oldValues),
          JSON.stringify(auditEntry.newValues),
          auditEntry.ipAddress, auditEntry.userAgent,
          auditEntry.success, auditEntry.errorMessage,
          auditEntry.processingTime, auditEntry.createdAt
        ]);
      } catch (error) {
        logger.error('Failed to log audit entry:', error);
      }
    });
  };
};
```

### Configuration Management

```typescript
// Complete configuration with environment support
export interface Config {
  server: {
    port: number;
    host: string;
    cors: {
      origin: string | string[];
      credentials: boolean;
    };
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
    acquireTimeout: number;
    timeout: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
    algorithm: 'HS256' | 'RS256';
  };
  security: {
    bcryptRounds: number;
    sessionSecret: string;
    csrfProtection: boolean;
    helmet: boolean;
  };
  optimization: {
    solverTimeout: number;
    maxEmployees: number;
    maxShifts: number;
    cacheResults: boolean;
    parallel: boolean;
  };
  notifications: {
    email: {
      enabled: boolean;
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
          user: string;
          pass: string;
        };
      };
    };
    push: {
      enabled: boolean;
      fcm: {
        serverKey: string;
        projectId: string;
      };
    };
  };
  integrations: {
    hr: {
      enabled: boolean;
      endpoint: string;
      apiKey: string;
    };
    payroll: {
      enabled: boolean;
      endpoint: string;
      apiKey: string;
    };
  };
  monitoring: {
    metrics: boolean;
    healthChecks: boolean;
    logging: {
      level: 'error' | 'warn' | 'info' | 'debug';
      file: boolean;
      console: boolean;
    };
  };
}

export const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || 'http://localhost:3000',
      credentials: true
    }
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'staff_scheduler',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
    acquireTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT || '60000'),
    timeout: parseInt(process.env.DB_TIMEOUT || '60000')
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: (process.env.JWT_ALGORITHM as any) || 'HS256'
  },
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
    sessionSecret: process.env.SESSION_SECRET || 'session-secret',
    csrfProtection: process.env.CSRF_PROTECTION === 'true',
    helmet: process.env.HELMET_PROTECTION !== 'false'
  },
  optimization: {
    solverTimeout: parseInt(process.env.SOLVER_TIMEOUT || '300000'), // 5 minutes
    maxEmployees: parseInt(process.env.MAX_EMPLOYEES || '1000'),
    maxShifts: parseInt(process.env.MAX_SHIFTS || '10000'),
    cacheResults: process.env.CACHE_RESULTS !== 'false',
    parallel: process.env.PARALLEL_SOLVING === 'true'
  },
  notifications: {
    email: {
      enabled: process.env.EMAIL_ENABLED === 'true',
      smtp: {
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_SECURE === 'false',
        auth: {
          user: process.env.EMAIL_USER || '',
          pass: process.env.EMAIL_PASSWORD || ''
        }
      }
    },
    push: {
      enabled: process.env.PUSH_ENABLED === 'true',
      fcm: {
        serverKey: process.env.FCM_SERVER_KEY || '',
        projectId: process.env.FCM_PROJECT_ID || ''
      }
    }
  },
  integrations: {
    hr: {
      enabled: process.env.HR_INTEGRATION === 'true',
      endpoint: process.env.HR_ENDPOINT || '',
      apiKey: process.env.HR_API_KEY || ''
    },
    payroll: {
      enabled: process.env.PAYROLL_INTEGRATION === 'true',
      endpoint: process.env.PAYROLL_ENDPOINT || '',
      apiKey: process.env.PAYROLL_API_KEY || ''
    }
  },
  monitoring: {
    metrics: process.env.METRICS_ENABLED !== 'false',
    healthChecks: process.env.HEALTH_CHECKS !== 'false',
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info',
      file: process.env.LOG_FILE === 'true',
      console: process.env.LOG_CONSOLE !== 'false'
    }
  }
};
```

---

## 8. Performance Optimization

### External System Interfaces

#### HR System Integration
```typescript
interface HRIntegration {
  syncEmployeeData(): Promise<SyncResult>;
  exportScheduleData(scheduleId: string): Promise<ExportResult>;
  handleEmployeeUpdate(employee: Employee): Promise<void>;
  validateEmployeeConstraints(employeeId: string): Promise<ValidationResult>;
}

interface SyncResult {
  totalRecords: number;
  updated: number;
  created: number;
  errors: SyncError[];
}
```

#### Payroll System Integration
```typescript
interface PayrollIntegration {
  exportHours(period: DateRange): Promise<HoursExport>;
  calculateOvertime(employeeId: string, period: DateRange): Promise<OvertimeCalc>;
  validatePayPeriod(period: DateRange): Promise<ValidationResult>;
}
```

#### Communication Gateway
```typescript
interface NotificationGateway {
  sendEmail(recipients: string[], subject: string, content: string): Promise<void>;
  sendSMS(phoneNumbers: string[], message: string): Promise<void>;
  sendPushNotification(userIds: string[], notification: PushNotification): Promise<void>;
}
```

### Event-Driven Architecture
```typescript
interface SystemEvent {
  id: string;
  type: 'schedule_approved' | 'employee_updated' | 'constraint_changed';
  payload: Record<string, any>;
  targetSystems: string[];
  timestamp: Date;
  processedBy: string[];
  retryCount: number;
  maxRetries: number;
}

interface EventHandler {
  canHandle(event: SystemEvent): boolean;
  handle(event: SystemEvent): Promise<HandlingResult>;
  onError(event: SystemEvent, error: Error): Promise<void>;
}
```

### API Gateway Configuration
- **Rate limiting**: Different limits for different endpoint categories
- **Authentication**: JWT token validation
- **Request/Response transformation**: Adapt to external system formats
- **Monitoring**: Request tracking, error logging, performance metrics

---

## 8. Security & Compliance

### Authentication & Authorization

#### JWT Token Management
```typescript
interface JWTConfig {
  secret: string;
  expiresIn: string; // '24h'
  refreshTokenExpiry: string; // '7d'
  algorithm: 'HS256' | 'RS256';
  issuer: string;
  audience: string[];
}

interface TokenPayload {
  userId: number;
  username: string;
  role: string;
  hierarchyLevel: number;
  permissions: string[];
  iat: number;
  exp: number;
}
```

#### Role-Based Access Control
```typescript
interface RBACConfig {
  roles: {
    admin: Permission[];
    manager: Permission[];
    employee: Permission[];
  };
  hierarchicalInheritance: boolean;
  permissionCaching: boolean;
  auditLogging: boolean;
}

interface SecurityContext {
  user: User;
  permissions: Permission[];
  hierarchyScope: string[];
  sessionId: string;
  ipAddress: string;
  userAgent: string;
}
```

### Data Protection

#### GDPR Compliance
- **Right to access**: Users can export their personal data
- **Right to rectification**: Users can correct their personal data
- **Right to erasure**: Users can request deletion of personal data
- **Data portability**: Export data in machine-readable format
- **Privacy by design**: Minimal data collection, encrypted storage

#### Encryption Strategy
- **Data at rest**: AES-256 encryption for sensitive fields
- **Data in transit**: TLS 1.3 for all communications
- **Password hashing**: bcrypt with salt rounds 12+
- **Token encryption**: JWE for sensitive token payloads

### Audit & Compliance

#### Audit Logging
```typescript
interface AuditLog {
  id: string;
  userId: number;
  action: string;
  resource: string;
  resourceId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}
```

#### Compliance Reports
- **Access reports**: Who accessed what data when
- **Change reports**: What data was modified and by whom
- **Permission reports**: Current permission assignments
- **Data retention reports**: Data age and retention compliance

---

## 9. API Specification

### RESTful API Design

#### Base Response Format
```typescript
interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  meta?: {
    timestamp: string;
    requestId: string;
    version: string;
  };
}
```

#### Error Codes
- `VALIDATION_ERROR`: Request validation failed
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `CONFLICT`: Resource conflict (e.g., duplicate)
- `RATE_LIMITED`: Too many requests
- `INTERNAL_ERROR`: Server error
- `LOGIN_FAILED`: Invalid credentials
- `TOKEN_EXPIRED`: JWT token expired
- `CONSTRAINT_VIOLATION`: Business rule violation

#### Rate Limiting
```typescript
interface RateLimitConfig {
  windowMs: number; // 15 minutes
  maxRequests: number; // 100 requests per window
  skipSuccessfulRequests: boolean;
  skipFailedRequests: boolean;
  keyGenerator: (req: Request) => string;
  onLimitReached: (req: Request, res: Response) => void;
}
```

### WebSocket API for Real-time Updates

#### Connection Management
```typescript
interface WebSocketConnection {
  userId: number;
  connectionId: string;
  subscriptions: string[];
  lastActivity: Date;
  isAuthenticated: boolean;
}

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'update' | 'notification';
  channel?: string;
  data: any;
  timestamp: Date;
  messageId: string;
}
```

#### Real-time Channels
- `schedule.{scheduleId}`: Schedule changes
- `user.{userId}`: Personal notifications
- `department.{departmentId}`: Department-wide updates
- `hierarchy.{hierarchyPath}`: Hierarchical updates

---

## 10. Deployment Configuration

### Docker Configuration

#### Multi-stage Production Dockerfile
```dockerfile
# Backend Production Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:18-alpine AS runner
RUN addgroup -g 1001 -S nodejs
RUN adduser -S backend -u 1001
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=backend:nodejs . .
RUN npm run build
USER backend
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["npm", "start"]
```

#### Production Docker Compose
```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      timeout: 20s
      retries: 10

  backend:
    build: ./backend
    restart: unless-stopped
    environment:
      NODE_ENV: production
      DB_HOST: mysql
      JWT_SECRET: ${JWT_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
    depends_on:
      mysql:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build: ./frontend
    restart: unless-stopped
    environment:
      REACT_APP_API_URL: ${API_URL}
    depends_on:
      - backend

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - frontend
      - backend

volumes:
  mysql_data:
    driver: local
```

### Environment Configuration

#### Production Environment Variables
```bash
# Database
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=staff_scheduler
DB_USER=staffscheduler
DB_PASSWORD=${SECURE_DB_PASSWORD}

# Security
JWT_SECRET=${RANDOM_JWT_SECRET_256_CHARS}
SESSION_SECRET=${RANDOM_SESSION_SECRET_256_CHARS}
BCRYPT_SALT_ROUNDS=12

# Application
NODE_ENV=production
PORT=3001
LOG_LEVEL=info

# External Services
EMAIL_HOST=${EMAIL_HOST}
EMAIL_PORT=587
EMAIL_USER=${EMAIL_USER}
EMAIL_PASSWORD=${EMAIL_PASSWORD}

# Monitoring
SENTRY_DSN=${SENTRY_DSN}
NEW_RELIC_LICENSE_KEY=${NEW_RELIC_KEY}
```

### Kubernetes Deployment (Optional)

#### Deployment Configuration
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: staffscheduler-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: staffscheduler-backend
  template:
    metadata:
      labels:
        app: staffscheduler-backend
    spec:
      containers:
      - name: backend
        image: staffscheduler/backend:latest
        ports:
        - containerPort: 3001
        env:
        - name: DB_HOST
          value: "mysql-service"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: staffscheduler-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/ready
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Monitoring & Observability

#### Health Checks
```typescript
interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: 'connected' | 'disconnected' | 'slow';
    redis: 'connected' | 'disconnected' | 'slow';
    external_apis: 'available' | 'unavailable' | 'degraded';
  };
  metrics: {
    memory_usage: number;
    cpu_usage: number;
    active_connections: number;
    request_rate: number;
  };
}
```

#### Logging Configuration
```typescript
interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  format: 'json' | 'text';
  outputs: ('console' | 'file' | 'syslog' | 'external')[];
  retention: {
    days: number;
    maxSize: string; // '100MB'
    maxFiles: number;
  };
  sensitiveFields: string[]; // Fields to redact in logs
}
```

---

*This comprehensive technical documentation provides all the mathematical models, implementation details, and deployment configurations needed for the Staff Scheduler system.*
