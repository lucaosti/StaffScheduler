# 📘 Technical Documentation - Staff Scheduler

> **Complete technical documentation of the workforce management and scheduling system**

## 📋 Table of Contents

1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Database Structure](#database-structure)
4. [Backend API](#backend-api)
5. [Frontend Application](#frontend-application)
6. [Optimization Algorithm](#optimization-algorithm)
7. [Security](#security)
8. [Performance and Scalability](#performance-and-scalability)
9. [Deployment](#deployment)
10. [Maintenance and Monitoring](#maintenance-and-monitoring)

---

## 🏗️ System Architecture

### General Architecture

Staff Scheduler follows a modern **three-tier** architecture based on containerized microservices:

```
┌─────────────────────────────────────────────────────────────┐
│                         Client Layer                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         React SPA (Single Page Application)          │   │
│  │  - React 18.2 + TypeScript                           │   │
│  │  - React Router v6                                   │   │
│  │  - Bootstrap 5 + React Bootstrap                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP/HTTPS (REST API)
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Express.js REST API Server                 │   │
│  │  - Node.js 18+ + TypeScript                          │   │
│  │  - Express.js 4.18                                   │   │
│  │  - JWT Authentication                                │   │
│  │  - Business Logic & Optimization Engine              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓ MySQL Protocol
┌─────────────────────────────────────────────────────────────┐
│                         Data Layer                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  MySQL 8.0 Database                  │   │
│  │  - Connection Pooling                                │   │
│  │  - Transaction Management                            │   │
│  │  - Relational Data Model                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Main Components

#### 1. Frontend Container (Port 3000)
- **Technology**: React 18.2 with TypeScript
- **Server**: Nginx (production) / React Dev Server (development)
- **Responsibilities**:
  - Responsive user interface
  - Application state management
  - Client-side routing
  - Client-side input validation

#### 2. Backend Container (Port 3001)
- **Technology**: Node.js 18+ with Express.js and TypeScript
- **Responsibilities**:
  - RESTful API
  - Business logic
  - Authentication and authorization
  - Schedule optimization
  - Report generation

#### 3. Database Container (Port 3306)
- **Technology**: MySQL 8.0
- **Responsibilities**:
  - Data persistence
  - Referential integrity
  - Transaction management
  - Query optimization

#### 4. phpMyAdmin Container (Port 8080)
- **Technology**: phpMyAdmin latest
- **Responsibilities**:
  - Web-based database management
  - Debugging and maintenance
  - Backup and restore

### Architectural Patterns

#### MVC (Model-View-Controller)
- **Model**: Backend services and database schema
- **View**: React components
- **Controller**: Express route handlers

#### Service Layer Pattern
Each entity has a dedicated service:
- `UserService.ts` - User management
- `EmployeeService.ts` - Employee management
- `ShiftService.ts` - Shift management
- `ScheduleService.ts` - Schedule management
- `AssignmentService.ts` - Assignments
- `DepartmentService.ts` - Departments
- `SystemSettingsService.ts` - Settings

#### Repository Pattern
Services abstract data access from the database, providing clean interfaces for CRUD operations.

---

## 💻 Stack Tecnologico

### Backend

#### Core Technologies
```json
{
  "runtime": "Node.js 18+",
  "language": "TypeScript 5.x",
  "framework": "Express.js 4.18",
  "database": "MySQL 8.0"
}
```

#### Main Dependencies

**Framework & Server**
- `express` (4.18.2) - Web framework
- `compression` (1.7.4) - HTTP compression
- `cors` (2.8.5) - Cross-Origin Resource Sharing

**Security**
- `helmet` (7.0.0) - Security headers
- `express-rate-limit` (6.8.1) - Rate limiting
- `bcrypt` (5.1.0) - Password hashing
- `jsonwebtoken` (9.0.2) - JWT authentication
- `express-validator` (7.0.1) - Input validation

**Database**
- `mysql2` (3.6.0) - MySQL client with Promise support
- `express-mysql-session` (3.0.0) - Session store

**Utilities**
- `dotenv` (16.3.1) - Environment variables
- `morgan` (1.10.0) - HTTP request logger
- `moment` (2.29.4) - Date manipulation
- `joi` (17.9.2) - Schema validation

**Export & Report**
- `exceljs` (4.3.0) - Excel generation
- `puppeteer` (22.0.0) - PDF generation
- `csv-parser` / `csv-writer` - CSV handling

**Scheduling**
- `node-cron` (3.0.2) - Scheduled tasks
- `node-schedule` (2.1.1) - Job scheduling

**Testing**
- `jest` (29.6.2) - Testing framework
- `supertest` (6.3.3) - HTTP assertions

### Frontend

#### Core Technologies
```json
{
  "library": "React 18.2",
  "language": "TypeScript 5.x",
  "styling": "Bootstrap 5.3",
  "routing": "React Router v6"
}
```

#### Dipendenze Principali

**React Ecosystem**
- `react` (18.2.0) - UI library
- `react-dom` (18.2.0) - React renderer
- `react-router-dom` (6.15.0) - Routing

**UI Components**
- `react-bootstrap` (2.8.0) - Bootstrap components
- `bootstrap` (5.3.0) - CSS framework
- `bootstrap-icons` (1.10.5) - Icon set

**State & Data**
- `axios` (1.4.0) - HTTP client
- `@tanstack/react-query` (4.32.0) - Server state management
- `react-hook-form` (7.45.2) - Form handling
- `yup` (1.2.0) - Schema validation

**Data Visualization**
- `recharts` (2.7.2) - Charts library
- `react-table` (7.8.0) - Tables

**Utilities**
- `date-fns` (2.30.0) - Date utilities
- `lodash` (4.17.21) - Utility functions
- `react-toastify` (9.1.3) - Notifications
- `react-dnd` (16.0.1) - Drag & Drop

**Export**
- `jspdf` (2.5.1) - PDF generation
- `xlsx` (0.18.5) - Excel handling
- `file-saver` (2.0.5) - File download

### DevOps

**Containerization**
- Docker 24+
- Docker Compose v2

**Web Servers**
- Nginx (production frontend)
- Express (API server)

**Database Management**
- phpMyAdmin (development)

---

## 🗄️ Database Structure

### Relational Schema

The database uses a normalized relational model (3NF) with 15+ main tables.

#### Main Entities

```sql
-- USERS (System users)
users
├── id (PK)
├── email (UNIQUE)
├── password_hash
├── first_name
├── last_name
├── role (admin|manager|department_manager|employee)
├── employee_id (UNIQUE)
└── timestamps

-- DEPARTMENTS (Organizational departments)
departments
├── id (PK)
├── name (UNIQUE)
├── description
├── parent_id (FK → departments.id)
├── manager_id (FK → users.id)
├── budget
└── timestamps

-- EMPLOYEES (Detailed employee profiles)
employees
├── id (PK)
├── user_id (FK → users.id)
├── department_id (FK → departments.id)
├── hire_date
├── contract_type
├── salary
├── max_hours_per_week
├── min_hours_per_week
└── timestamps

-- SHIFTS (Shift definitions)
shifts
├── id (PK)
├── name
├── start_time
├── end_time
├── department_id (FK → departments.id)
├── required_staff
├── color
└── timestamps

-- SCHEDULES (Schedule plans)
schedules
├── id (PK)
├── name
├── start_date
├── end_date
├── department_id (FK → departments.id)
├── status (draft|published|archived)
├── created_by (FK → users.id)
└── timestamps

-- ASSIGNMENTS (Shift-employee assignments)
assignments
├── id (PK)
├── schedule_id (FK → schedules.id)
├── employee_id (FK → employees.id)
├── shift_id (FK → shifts.id)
├── assignment_date
├── status (scheduled|completed|cancelled)
└── timestamps
```

#### Support Tables

```sql
-- SKILLS (Skills/competencies)
skills
├── id (PK)
├── name (UNIQUE)
├── description
├── category
└── timestamps

-- EMPLOYEE_SKILLS (Junction table)
employee_skills
├── id (PK)
├── employee_id (FK → employees.id)
├── skill_id (FK → skills.id)
├── proficiency_level (1-5)
└── certification_date

-- TIME_OFF_REQUESTS (Leave/time-off requests)
time_off_requests
├── id (PK)
├── employee_id (FK → employees.id)
├── request_type (vacation|sick|personal)
├── start_date
├── end_date
├── status (pending|approved|rejected)
├── approved_by (FK → users.id)
└── timestamps

-- SYSTEM_SETTINGS (System configurations)
system_settings
├── id (PK)
├── category
├── setting_key
├── setting_value
├── data_type (string|number|boolean|json)
└── timestamps

-- AUDIT_LOG (Change tracking)
audit_log
├── id (PK)
├── user_id (FK → users.id)
├── action
├── entity_type
├── entity_id
├── old_values (JSON)
├── new_values (JSON)
└── timestamp
```

### Indexes and Optimizations

```sql
-- Performance indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_employee_id ON users(employee_id);
CREATE INDEX idx_assignments_date ON assignments(assignment_date);
CREATE INDEX idx_assignments_employee ON assignments(employee_id, assignment_date);
CREATE INDEX idx_schedules_dates ON schedules(start_date, end_date);
CREATE INDEX idx_shifts_department ON shifts(department_id);

-- Composite indexes for frequent queries
CREATE INDEX idx_assignments_lookup ON assignments(schedule_id, employee_id, assignment_date);
CREATE INDEX idx_employee_department ON employees(department_id, is_active);
```

### Constraints and Integrity

```sql
-- Foreign Keys with cascading
ALTER TABLE user_departments
  ADD CONSTRAINT fk_user FOREIGN KEY (user_id) 
  REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE assignments
  ADD CONSTRAINT fk_employee FOREIGN KEY (employee_id)
  REFERENCES employees(id) ON DELETE RESTRICT;

-- Check constraints
ALTER TABLE employees
  ADD CONSTRAINT chk_hours CHECK (max_hours_per_week >= min_hours_per_week);

ALTER TABLE shifts
  ADD CONSTRAINT chk_time CHECK (end_time > start_time);
```

---

## 🔌 Backend API

### API Architecture

The API follows **REST** principles with hierarchical routing and versioning.

#### Endpoint Structure

```
/api
├── /auth
│   ├── POST /login
│   ├── POST /logout
│   ├── POST /register
│   ├── GET /me
│   └── POST /refresh
│
├── /users
│   ├── GET /users
│   ├── GET /users/:id
│   ├── POST /users
│   ├── PUT /users/:id
│   └── DELETE /users/:id
│
├── /employees
│   ├── GET /employees
│   ├── GET /employees/:id
│   ├── POST /employees
│   ├── PUT /employees/:id
│   ├── DELETE /employees/:id
│   ├── GET /employees/:id/skills
│   ├── POST /employees/:id/skills
│   └── GET /employees/:id/availability
│
├── /departments
│   ├── GET /departments
│   ├── GET /departments/:id
│   ├── POST /departments
│   ├── PUT /departments/:id
│   ├── DELETE /departments/:id
│   └── GET /departments/:id/employees
│
├── /shifts
│   ├── GET /shifts
│   ├── GET /shifts/:id
│   ├── POST /shifts
│   ├── PUT /shifts/:id
│   ├── DELETE /shifts/:id
│   └── POST /shifts/bulk
│
├── /schedules
│   ├── GET /schedules
│   ├── GET /schedules/:id
│   ├── POST /schedules
│   ├── PUT /schedules/:id
│   ├── DELETE /schedules/:id
│   ├── POST /schedules/:id/publish
│   ├── POST /schedules/:id/optimize
│   └── GET /schedules/:id/conflicts
│
├── /assignments
│   ├── GET /assignments
│   ├── GET /assignments/:id
│   ├── POST /assignments
│   ├── PUT /assignments/:id
│   ├── DELETE /assignments/:id
│   └── POST /assignments/bulk
│
├── /dashboard
│   ├── GET /dashboard/stats
│   ├── GET /dashboard/recent-activity
│   └── GET /dashboard/alerts
│
├── /reports
│   ├── GET /reports/hours
│   ├── GET /reports/costs
│   ├── GET /reports/coverage
│   └── POST /reports/export
│
├── /settings
│   ├── GET /settings
│   ├── GET /settings/:category
│   ├── PUT /settings/:key
│   └── POST /settings/bulk
│
└── /health
    ├── GET /health
    └── GET /health/detailed
```

### Middleware Stack

```typescript
// Middleware execution order
app.use(helmet());                    // 1. Security headers
app.use(cors(corsOptions));           // 2. CORS handling
app.use(compression());               // 3. Response compression
app.use(morgan('combined'));          // 4. Request logging
app.use(express.json());              // 5. JSON body parser
app.use(express.urlencoded());        // 6. URL-encoded parser
app.use(rateLimiter);                 // 7. Rate limiting
app.use(sessionMiddleware);           // 8. Session handling
app.use(authenticateUser);            // 9. Authentication (specific routes)
app.use(authorizeRole);               // 10. Authorization (specific routes)
```

### Authentication and Authorization

#### JWT Token Flow

```typescript
// 1. Login request
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password123"
}

// 2. Response with token
{
  "success": true,
  "data": {
    "user": { /* user data */ },
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 86400
  }
}

// 3. Subsequent requests with header
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

#### Authentication Middleware

```typescript
// backend/src/middleware/auth.ts
export const authenticateUser = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await UserService.findById(decoded.userId);
    
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorizeRole = (...roles: string[]) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions' 
      });
    }
    next();
  };
};
```

### Input Validation

Using `express-validator` for robust validation:

```typescript
import { body, param, query, validationResult } from 'express-validator';

// Example: Employee creation validation
export const validateEmployee = [
  body('user_id').isInt().withMessage('Valid user ID required'),
  body('department_id').isInt().withMessage('Valid department ID required'),
  body('hire_date').isISO8601().withMessage('Valid date required'),
  body('max_hours_per_week')
    .isInt({ min: 1, max: 168 })
    .withMessage('Hours must be between 1 and 168'),
  body('email').isEmail().normalizeEmail(),
  
  // Middleware to handle errors
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];
```

### Error Handling

Centralized error handling system:

```typescript
// Custom error class
class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
  }
}

// Global error handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({
    statusCode,
    message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
```

### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP
  message: 'Too many requests, please try again later'
});

// Authentication rate limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Only 5 login attempts
  skipSuccessfulRequests: true
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
```

---

## 🎨 Frontend Application

### React Architecture

#### Component Hierarchy

```
App (AuthProvider)
├── Routes
│   ├── Login (Public)
│   └── ProtectedRoute
│       └── Layout
│           ├── Header
│           ├── Sidebar
│           └── Content
│               ├── Dashboard
│               ├── Employees
│               ├── Shifts
│               ├── Schedule
│               ├── Reports
│               └── Settings
```

### State Management

#### 1. Context API for Authentication

```typescript
// contexts/AuthContext.tsx
interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ 
  children 
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Verify saved token
    const token = localStorage.getItem('authToken');
    if (token) {
      validateToken(token);
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authService.login(email, password);
    setUser(response.user);
    localStorage.setItem('authToken', response.token);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('authToken');
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated: !!user, 
      isLoading,
      login, 
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};
```

#### 2. React Query for Server State

```typescript
// Example: Hook for employee management
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export const useEmployees = () => {
  return useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.getAll(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useCreateEmployee = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (employee: EmployeeInput) => 
      employeeService.create(employee),
    onSuccess: () => {
      queryClient.invalidateQueries(['employees']);
      toast.success('Employee created successfully');
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    }
  });
};
```

### Routing and Navigation

```typescript
// App.tsx
const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/dashboard" />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/employees" element={<Employees />} />
              <Route path="/employees/:id" element={<EmployeeDetail />} />
              <Route path="/shifts" element={<Shifts />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};
```

### API Services (Client)

```typescript
// services/employeeService.ts
import axios from 'axios';
import { API_URL } from '../config';

class EmployeeService {
  private baseURL = `${API_URL}/api/employees`;

  async getAll(filters?: EmployeeFilters): Promise<Employee[]> {
    const response = await axios.get(this.baseURL, { 
      params: filters,
      headers: this.getAuthHeaders()
    });
    return response.data.data;
  }

  async getById(id: number): Promise<Employee> {
    const response = await axios.get(`${this.baseURL}/${id}`, {
      headers: this.getAuthHeaders()
    });
    return response.data.data;
  }

  async create(employee: EmployeeInput): Promise<Employee> {
    const response = await axios.post(this.baseURL, employee, {
      headers: this.getAuthHeaders()
    });
    return response.data.data;
  }

  async update(id: number, employee: Partial<Employee>): Promise<Employee> {
    const response = await axios.put(`${this.baseURL}/${id}`, employee, {
      headers: this.getAuthHeaders()
    });
    return response.data.data;
  }

  async delete(id: number): Promise<void> {
    await axios.delete(`${this.baseURL}/${id}`, {
      headers: this.getAuthHeaders()
    });
  }

  private getAuthHeaders() {
    const token = localStorage.getItem('authToken');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }
}

export default new EmployeeService();
```

### Form Handling

```typescript
// Example: Form with React Hook Form + Yup
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

const employeeSchema = yup.object({
  firstName: yup.string().required('First name is required'),
  lastName: yup.string().required('Last name is required'),
  email: yup.string().email('Invalid email').required('Email is required'),
  departmentId: yup.number().required('Department is required'),
  maxHoursPerWeek: yup.number()
    .min(1, 'Minimum 1 hour')
    .max(168, 'Maximum 168 hours')
    .required('Max hours required')
});

const EmployeeForm: React.FC = () => {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: yupResolver(employeeSchema)
  });

  const createMutation = useCreateEmployee();

  const onSubmit = (data: EmployeeInput) => {
    createMutation.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="mb-3">
        <label>First Name</label>
        <input 
          {...register('firstName')} 
          className="form-control"
        />
        {errors.firstName && (
          <span className="text-danger">{errors.firstName.message}</span>
        )}
      </div>
      {/* Other fields... */}
      <button type="submit" disabled={createMutation.isLoading}>
        {createMutation.isLoading ? 'Creating...' : 'Create Employee'}
      </button>
    </form>
  );
};
```

---

## 🧮 Optimization Algorithm

### Overview

Staff Scheduler uses **Google OR-Tools CP-SAT (Constraint Programming - Satisfiability) solver** for intelligent schedule optimization. This approach is inspired by the [PoliTO_Timetable_Allocator](https://github.com/Paolino01/PoliTO_Timetable_Allocator) which uses IBM CPLEX for university timetable scheduling.

**Key Design Decision**: While PoliTO uses IBM CPLEX (commercial, Python docplex), Staff Scheduler uses Google OR-Tools (open-source, also Python) with similar constraint programming capabilities.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Node.js/TypeScript                    │
│         ScheduleOptimizerORTools.ts (Wrapper)            │
│  • Prepares problem data (JSON)                          │
│  • Manages Python process lifecycle                      │
│  • Handles errors and timeouts                           │
│  • Provides fallback greedy algorithm                    │
└────────────────────┬─────────────────────────────────────┘
                     │ JSON via stdin/stdout
                     ▼
┌──────────────────────────────────────────────────────────┐
│                    Python 3.8+                           │
│      schedule_optimizer.py (OR-Tools CP-SAT)             │
│  • Constraint programming model                          │
│  • Boolean assignment variables                          │
│  • Hard + soft constraints                               │
│  • Weighted objective function                           │
│  • Returns optimal/feasible solution                     │
└──────────────────────────────────────────────────────────┘
```

### Why Constraint Programming?

Compared to traditional approaches (Linear Programming, heuristics):

**Advantages:**
- ✅ Natural modeling of logical constraints (if-then, exactly-one)
- ✅ Efficient handling of combinatorial problems
- ✅ Provably optimal solutions (or best found within time limit)
- ✅ Built-in conflict detection and resolution
- ✅ Scales well with parallel processing

**Comparison with PoliTO Approach:**

| Aspect | PoliTO (Timetable) | StaffScheduler (Shifts) |
|--------|-------------------|------------------------|
| **Solver** | IBM CPLEX docplex | Google OR-Tools CP-SAT |
| **License** | Commercial | Open-source (Apache 2.0) |
| **Language** | Python | Python + Node.js wrapper |
| **Problem** | Teaching assignments | Shift assignments |
| **Main Variables** | `insegnamento[teaching, slot]` | `assign[employee, shift]` |
| **Coverage** | Each teaching = 1 slot | Each shift = min-max staff |
| **Conflicts** | Teacher availability | Overlapping shifts |
| **Preferences** | Teaching correlations (weights) | Shift preferences (weights) |
| **Objective** | Minimize weighted penalties | Maximize weighted satisfaction |

### CP-SAT Model Structure

#### 1. Decision Variables

**Boolean Assignment Variables:**
```python
assign[employee_id, shift_id] ∈ {0, 1}
```
- `1` if employee is assigned to shift
- `0` otherwise
- Total variables: `|Employees| × |Shifts|`

Example with 50 employees and 150 shifts = 7,500 boolean variables.

#### 2. Hard Constraints (Must Satisfy)

**a) Shift Coverage** (inspired by PoliTO teaching coverage)
```python
∀ shift: min_staff ≤ Σ(assign[emp, shift]) ≤ max_staff
```
Each shift must have between min and max staff assigned.

**b) No Double-Booking** (inspired by PoliTO teaching overlaps)
```python
∀ employee, ∀ overlapping_shifts: Σ(assign[emp, overlapping]) ≤ 1
```
Employee cannot work overlapping shifts.

**c) Skill Requirements** (inspired by PoliTO teaching competency)
```python
∀ (emp, shift): required_skills ⊄ employee_skills → assign[emp, shift] = 0
```
Only qualified employees can be assigned.

**d) Availability** (inspired by PoliTO teacher availability)
```python
∀ (emp, shift): shift_date ∈ unavailable_dates → assign[emp, shift] = 0
```
Employees cannot work when unavailable.

**e) Max Hours per Week**
```python
∀ employee, ∀ week: Σ(assign[emp, shift] × hours[shift]) ≤ max_hours_per_week
```
Weekly hour limits must be respected.

#### 3. Soft Constraints (Optimization Objectives)

**Weighted Objective Function:**
```python
Maximize: 
  + W_pref × Σ(assign[emp, shift] × preference_score[emp, shift])
  + W_fair × fairness_bonus
  - W_cons × consecutive_days_penalty
  + W_cont × continuity_bonus
```

**a) Employee Preferences** (weight: 55, inspired by PoliTO correlations)
```python
preference_score[emp, shift] = {
  +10  if shift ∈ preferred_shifts[emp]
   0   if neutral
  -10  if shift ∈ avoid_shifts[emp]
}
```

Similar to PoliTO's teaching correlation matrix where preferred teaching pairs get positive weights.

**b) Workload Fairness** (weight: 40)
Minimize variance in assigned hours across employees.

**c) Consecutive Days** (weight: 30, similar to PoliTO lecture_dispersion_penalty: 25)
```python
∀ employee, ∀ consecutive_window > max_consecutive_days:
  penalty = -weight if working all days in window
```

Encourages rest days, similar to PoliTO's preference for distributing lectures across different days.

**d) Shift Continuity** (weight: 20)
Bonus for consistent shift patterns (same shifts, same days of week).

#### 4. Constraint Weights Configuration

Inspired by PoliTO's `Parameters.py` approach with customizable weights:

| Constraint | Default Weight | Priority | PoliTO Equivalent |
|-----------|---------------|----------|-------------------|
| **Hard Constraints** | | | |
| Shift Coverage | 100 | Critical | `teaching_coverage_penalty` |
| No Double-Booking | 90 | Critical | Implicit (no overlaps) |
| Skill Requirements | 85 | High | `teaching_competency` |
| Availability | 80 | High | `teacher_availability` |
| Max Hours/Week | 75 | High | `max_teaching_hours` |
| **Soft Constraints** | | | |
| Employee Preferences | 55 | Medium | `teaching_overlaps_penalty: 50` |
| Workload Fairness | 40 | Medium | N/A |
| Consecutive Days | 30 | Low | `lecture_dispersion_penalty: 25` |
| Rest Periods | 25 | Low | N/A |
| Shift Continuity | 20 | Low | `double_slot_preference` |

**Configuration in Code:**
```python
weights = {
    'shift_coverage': 100,
    'no_double_booking': 90,
    'skill_requirements': 85,
    'availability': 80,
    'max_hours_per_week': 75,
    'employee_preferences': 55,  # Like PoliTO's teaching overlaps
    'workload_fairness': 40,
    'consecutive_days': 30,      # Like PoliTO's lecture dispersion
    'rest_periods': 25,
    'shift_continuity': 20
}
```

### CP-SAT Solving Algorithm

#### 1. Model Building Phase

```python
def build_model(self):
    # Create boolean variables
    for employee in employees:
        for shift in shifts:
            self.assignments[(employee.id, shift.id)] = model.NewBoolVar(
                f'assign_e{employee.id}_s{shift.id}'
            )
    
    # Add hard constraints
    self._add_shift_coverage_constraints()
    self._add_no_double_booking_constraints()
    self._add_skill_requirements_constraints()
    self._add_availability_constraints()
    self._add_max_hours_constraints()
    
    # Build objective function
    objective_terms = []
    for (emp_id, shift_id), var in self.assignments.items():
        preference = self._get_preference(emp_id, shift_id)
        objective_terms.append(var * preference * pref_weight)
    
    model.Maximize(sum(objective_terms))
```

#### 2. Solving Phase (CP-SAT Solver)

```python
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = time_limit
solver.parameters.log_search_progress = True

# Solve with branch-and-bound + SAT techniques
status = solver.Solve(model)

if status == cp_model.OPTIMAL:
    # Extract solution
    for (emp_id, shift_id), var in assignments.items():
        if solver.Value(var) == 1:
            result.append({
                'employee_id': emp_id,
                'shift_id': shift_id
            })
```

**CP-SAT Solver Features:**
- **Branch and Bound**: Systematically explores solution space
- **Conflict-Driven Learning**: Learns from infeasible branches
- **Lazy Clause Generation**: Generates constraints on-the-fly
- **Parallel Search**: Multi-threaded exploration (uses all CPU cores)
- **Optimality Proof**: Can prove solution is optimal

#### 3. Performance Characteristics

**Time Complexity:**
- Worst case: Exponential O(2^n) where n = |employees| × |shifts|
- Practical: Often finds optimal in polynomial time due to pruning
- With time limit: Always returns best found solution

**Typical Solve Times** (8-core CPU):
- **Small** (10 emp, 50 shifts): < 5 seconds (usually optimal)
- **Medium** (50 emp, 200 shifts): 30-120 seconds (optimal or near-optimal)
- **Large** (100 emp, 500 shifts): 2-10 minutes (feasible, may not prove optimality)

**Memory Usage:**
- Model size: ~100 KB per 1000 variables
- Solver overhead: ~50-200 MB
- Solution storage: O(assigned shifts)

### Implementation in Staff Scheduler

#### Python Script (`schedule_optimizer.py`)

Located in `backend/optimization-scripts/`, this script:

1. **Reads JSON input from stdin:**
   ```json
   {
     "shifts": [...],
     "employees": [...],
     "preferences": {...},
     "weights": {...}
   }
   ```

2. **Builds CP-SAT model:**
   ```python
   model = cp_model.CpModel()
   assignments = {}  # (emp_id, shift_id) -> BoolVar
   
   for shift in shifts:
       for employee in employees:
           var = model.NewBoolVar(f'assign_e{emp}_s{shift}')
           assignments[(emp, shift)] = var
   ```

3. **Adds constraints:**
   ```python
   # Shift coverage
   for shift in shifts:
       assigned = [assignments[(emp, shift.id)] for emp in employees]
       model.Add(sum(assigned) >= shift.min_staff)
       model.Add(sum(assigned) <= shift.max_staff)
   ```

4. **Solves and returns JSON:**
   ```json
   {
     "status": "OPTIMAL",
     "objective_value": 1250.5,
     "solve_time_seconds": 45.2,
     "assignments": [
       {
         "employee_id": "1",
         "shift_id": "101",
         "date": "2025-11-15",
         "hours": 8
       },
       ...
     ],
     "statistics": {
       "num_branches": 12345,
       "num_conflicts": 234,
       "coverage_stats": {
         "total_shifts": 150,
         "fully_covered_shifts": 148,
         "coverage_percentage": 98.7
       }
     }
   }
   ```

#### TypeScript Wrapper (`ScheduleOptimizerORTools.ts`)

```typescript
import { spawn } from 'child_process';

class ScheduleOptimizer {
  async optimize(problem: OptimizationProblem): Promise<OptimizationResult> {
    // Spawn Python process
    const pythonProcess = spawn('python3', [
      'optimization-scripts/schedule_optimizer.py',
      '--stdin',
      '--stdout',
      '--time-limit', '300'
    ]);
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      
      pythonProcess.stdout.on('data', data => {
        stdout += data.toString();
      });
      
      pythonProcess.on('close', code => {
        if (code === 0) {
          resolve(JSON.parse(stdout));
        } else {
          reject(new Error('Optimization failed'));
        }
      });
      
      // Send problem data
      pythonProcess.stdin.write(JSON.stringify(problem));
      pythonProcess.stdin.end();
    });
  }
}
```

#### Integration with ScheduleService

```typescript
// In ScheduleService.ts
async optimizeSchedule(scheduleId: number): Promise<void> {
  // 1. Load schedule data from database
  const shifts = await this.getShifts(scheduleId);
  const employees = await this.getAvailableEmployees();
  const preferences = await this.getPreferences();
  
  // 2. Prepare problem
  const problem = {
    shifts: shifts.map(s => ({
      id: s.id.toString(),
      date: s.date,
      start_time: s.startTime,
      end_time: s.endTime,
      min_staff: s.minStaff,
      required_skills: s.skills
    })),
    employees: employees.map(e => ({
      id: e.id.toString(),
      max_hours_per_week: e.maxHoursPerWeek,
      skills: e.skills,
      unavailable_dates: e.unavailableDates
    })),
    preferences
  };
  
  // 3. Run optimizer
  const result = await scheduleOptimizer.optimize(problem);
  
  // 4. Store assignments in database
  if (result.status === 'OPTIMAL' || result.status === 'FEASIBLE') {
    await this.saveAssignments(scheduleId, result.assignments);
    logger.info(`Optimized schedule ${scheduleId}: ${result.assignments.length} assignments`);
  } else {
    throw new Error(`Optimization failed: ${result.status}`);
  }
}
```

### Fallback: Greedy Algorithm

If Python/OR-Tools unavailable, TypeScript fallback:
        penalty += (hours - employee.maxHoursPerWeek) * 100;
      }
    }
    return penalty;
  }
}
```

#### Example: Shift Preferences (Soft)

```typescript
{
  type: 'soft',
  name: 'shift_preferences',
  priority: 5,
  validate: () => true, // Always valid (soft)
  penalty: (schedule: ScheduleAssignment[]) => {
    let penalty = 0;
    
    for (const assignment of schedule) {
      const employee = this.getEmployee(assignment.employeeId);
      const preferences = employee.preferences;
      
      // Penalty for shifts to avoid
      if (preferences.avoidShifts.includes(assignment.shiftId)) {
        penalty += 20;
      }
      
      // Bonus (negative penalty) for preferred shifts
      if (preferences.preferredShifts.includes(assignment.shiftId)) {
        penalty -= 10;
      }
    }
    
    return penalty;
  }
}
```

### Performance Optimization

```typescript
// Caching to avoid recalculations
private memoizedCalculations = new Map<string, any>();

private calculateWeeklyHours(schedule: ScheduleAssignment[]): Map<string, number> {
  const cacheKey = this.getScheduleHash(schedule);
  
  if (this.memoizedCalculations.has(cacheKey)) {
    return this.memoizedCalculations.get(cacheKey);
  }
  
  const result = /* calculation */;
  this.memoizedCalculations.set(cacheKey, result);
  
  return result;
}
```

---

## 🔐 Security

### Security Layers

#### 1. Network Level Security

```yaml
# docker-compose.yml
networks:
  staff_scheduler_network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

All services communicate through a private Docker network.

#### 2. Security Headers (Helmet)

```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true
}));
```

#### 3. CORS Configuration

```typescript
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = config.cors.allowedOrigins.split(',');
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
```

#### 4. Password Hashing

```typescript
import bcrypt from 'bcrypt';

export class PasswordService {
  private static SALT_ROUNDS = 12;

  static async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  static async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static validate(password: string): boolean {
    // Minimum 8 characters, at least one uppercase, lowercase, number
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return regex.test(password);
  }
}
```

#### 5. SQL Injection Prevention

```typescript
// Exclusive use of prepared statements
const [rows] = await pool.execute(
  'SELECT * FROM users WHERE email = ? AND is_active = ?',
  [email, true]
);

// ALWAYS AVOID:
// const query = `SELECT * FROM users WHERE email = '${email}'`; // ❌ VULNERABLE
```

#### 6. XSS Prevention

```typescript
import { body } from 'express-validator';

// Input sanitization
export const sanitizeInput = [
  body('*').trim().escape(),
  body('email').normalizeEmail()
];
```

#### 7. Rate Limiting

```typescript
// Login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many login attempts. Please try again later.'
    });
  }
});
```

#### 8. Session Management

```typescript
import session from 'express-session';
import MySQLStore from 'express-mysql-session';

const sessionStore = new MySQLStore({}, pool);

app.use(session({
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    httpOnly: true, // Prevents JavaScript access
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict' // CSRF protection
  }
}));
```

#### 9. JWT Best Practices

```typescript
const token = jwt.sign(
  { 
    userId: user.id,
    role: user.role,
    // Don't include sensitive info!
  },
  config.jwtSecret,
  {
    expiresIn: '24h',
    issuer: 'staff-scheduler',
    audience: 'staff-scheduler-api'
  }
);

// Verify token
const decoded = jwt.verify(token, config.jwtSecret, {
  issuer: 'staff-scheduler',
  audience: 'staff-scheduler-api'
});
```

#### 10. Audit Logging

```typescript
export const auditLog = async (
  userId: number,
  action: string,
  entityType: string,
  entityId: number,
  oldValues?: any,
  newValues?: any
) => {
  await pool.execute(
    `INSERT INTO audit_log 
     (user_id, action, entity_type, entity_id, old_values, new_values) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      action,
      entityType,
      entityId,
      JSON.stringify(oldValues),
      JSON.stringify(newValues)
    ]
  );
};
```

---

## ⚡ Performance and Scalability

### Database Optimization

#### Connection Pooling

```typescript
// config/database.ts
export const pool = createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10, // Max 10 simultaneous connections
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});
```

#### Query Optimization

```typescript
// Appropriate indexing
CREATE INDEX idx_assignments_lookup 
ON assignments(schedule_id, employee_id, assignment_date);

// Optimized query with JOIN instead of multiple queries
const query = `
  SELECT 
    a.*,
    e.first_name,
    e.last_name,
    s.name as shift_name,
    s.start_time,
    s.end_time
  FROM assignments a
  INNER JOIN employees e ON a.employee_id = e.id
  INNER JOIN shifts s ON a.shift_id = s.id
  WHERE a.schedule_id = ?
  AND a.assignment_date BETWEEN ? AND ?
`;
```

#### Caching Strategy

```typescript
// In-memory cache with TTL
import NodeCache from 'node-cache';

const cache = new NodeCache({ 
  stdTTL: 600, // 10 minutes
  checkperiod: 120 
});

export const getCachedData = async (key: string, fetcher: () => Promise<any>) => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const data = await fetcher();
  cache.set(key, data);
  return data;
};
```

### Frontend Performance

#### Code Splitting

```typescript
// Lazy loading of routes
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Employees = lazy(() => import('./pages/Employees/Employees'));
const Schedule = lazy(() => import('./pages/Schedule/Schedule'));

// Usage with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <Routes>
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/employees" element={<Employees />} />
    <Route path="/schedule" element={<Schedule />} />
  </Routes>
</Suspense>
```

#### Memoization

```typescript
import { useMemo, useCallback } from 'react';

const EmployeeList: React.FC<{ employees: Employee[] }> = ({ employees }) => {
  // Memoize expensive calculations
  const sortedEmployees = useMemo(() => {
    return employees.sort((a, b) => 
      a.lastName.localeCompare(b.lastName)
    );
  }, [employees]);

  // Memoize callbacks
  const handleSelect = useCallback((id: number) => {
    // ... logic
  }, []);

  return (
    <div>
      {sortedEmployees.map(emp => (
        <EmployeeCard 
          key={emp.id} 
          employee={emp} 
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
};
```

#### React.memo for Components

```typescript
import React, { memo } from 'react';

const EmployeeCard = memo<{ employee: Employee; onSelect: (id: number) => void }>(
  ({ employee, onSelect }) => {
    return (
      <div onClick={() => onSelect(employee.id)}>
        {employee.firstName} {employee.lastName}
      </div>
    );
  },
  // Custom comparison
  (prevProps, nextProps) => {
    return prevProps.employee.id === nextProps.employee.id &&
           prevProps.employee.updatedAt === nextProps.employee.updatedAt;
  }
);
```

### Horizontal Scalability

#### Load Balancing with Nginx

```nginx
# nginx.conf for load balancing
upstream backend_servers {
    least_conn; # Least connections algorithm
    server backend1:3001;
    server backend2:3001;
    server backend3:3001;
}

server {
    listen 80;
    
    location /api {
        proxy_pass http://backend_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Multi-Instance Containerization

```yaml
# docker-compose.yml for scaling
services:
  backend:
    image: staff-scheduler-backend
    deploy:
      replicas: 3 # 3 backend instances
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

---

## 🚀 Deployment

### Docker Production Build

#### Backend Dockerfile

```dockerfile
# Multi-stage build for optimal size
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
```

#### Frontend Dockerfile

```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine AS production

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
```

### Environment Variables

```bash
# .env.production
NODE_ENV=production

# Database
DB_HOST=mysql
DB_PORT=3306
DB_NAME=staff_scheduler
DB_USER=scheduler_user
DB_PASSWORD=your_secure_password

# JWT & Session
JWT_SECRET=your_jwt_secret_key_min_32_chars
SESSION_SECRET=your_session_secret_key_min_32_chars

# CORS
CORS_ORIGIN=https://yourdomain.com

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# Logging
LOG_LEVEL=info
```

### SSL/TLS Configuration

```nginx
# nginx SSL configuration
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://frontend:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://backend:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Backup Strategy
```

### Backup Strategy

```bash
#!/bin/bash
# backup.sh - Database backup script

BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME="staff_scheduler"

# MySQL dump
docker exec staff_scheduler_mysql mysqldump \
  -u root -p${MYSQL_ROOT_PASSWORD} \
  --single-transaction \
  --quick \
  --lock-tables=false \
  ${DB_NAME} | gzip > "${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"

# Keep only last 30 days of backups
find ${BACKUP_DIR} -name "backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: backup_${TIMESTAMP}.sql.gz"
```

---

## 🔍 Maintenance and Monitoring

### Health Checks

```typescript
// routes/health.ts
router.get('/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

router.get('/health/detailed', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: await checkDatabase(),
      memory: checkMemory(),
      disk: await checkDisk()
    }
  };

  const isHealthy = Object.values(health.services).every(s => s.status === 'ok');
  res.status(isHealthy ? 200 : 503).json(health);
});
```

### Logging

```typescript
// config/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // File logging
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    }),
    
    // Console logging (development)
    ...(process.env.NODE_ENV !== 'production' ? [
      new winston.transports.Console({
        format: winston.format.simple()
      })
    ] : [])
  ]
});
```

### Monitoring Script

```bash
#!/bin/bash
# maintenance.sh - Interactive maintenance menu

show_menu() {
    echo "================================"
    echo " Staff Scheduler - Maintenance"
    echo "================================"
    echo "1. View Logs"
    echo "2. Database Backup"
    echo "3. Container Status"
    echo "4. Resource Usage"
    echo "5. Restart Services"
    echo "6. Clean Old Data"
    echo "0. Exit"
    echo "================================"
}

case $choice in
    1) docker-compose logs -f --tail=100 ;;
    2) ./scripts/backup.sh ;;
    3) docker-compose ps ;;
    4) docker stats --no-stream ;;
    5) docker-compose restart ;;
    6) ./scripts/cleanup.sh ;;
esac
```

---

## 📊 Metrics and KPIs

### Performance Metrics

- **API Response Time**: < 200ms (95th percentile)
- **Database Query Time**: < 50ms (average)
- **Frontend Load Time**: < 2s (First Contentful Paint)
- **Uptime**: > 99.9%

### Business Metrics

- Staff utilization (% scheduled vs available hours)
- Personnel costs by department
- Shift coverage rate
- Average schedule generation time
- Number of conflicts/violated constraints

---

## 🔮 Future Roadmap

### Planned Features

1. **Mobile App** - Native iOS/Android app with React Native
2. **Push Notifications** - Real-time notification system
3. **AI Predictions** - Machine Learning for workload predictions
4. **Multi-tenant** - Multi-company support
5. **GraphQL API** - GraphQL alternative to REST APIs
6. **Integrations** - Integration with external HR systems (SAP, Workday)

---

## 📚 Additional Resources

### Reference Documentation

- [Express.js Docs](https://expressjs.com/)
- [React Docs](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [MySQL Documentation](https://dev.mysql.com/doc/)
- [Docker Documentation](https://docs.docker.com/)

### Best Practices

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [React Best Practices](https://react.dev/learn/thinking-in-react)
- [RESTful API Design](https://restfulapi.net/)
- [SQL Optimization](https://use-the-index-luke.com/)

---

## 👥 Support and Contributions

For technical support or to contribute to the project:

- **Issues**: [GitHub Issues](https://github.com/lucaosti/StaffScheduler/issues)
- **Pull Requests**: See [CONTRIBUTING.md](./CONTRIBUTING.md)
- **API Documentation**: [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

---

<div align="center">

**Staff Scheduler** - Advanced Workforce Management System

Developed with ❤️ by Luca Ostinelli

*Version 1.0.0 - October 2025*

</div>
