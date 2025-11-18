# 📅 Staff Scheduler

> **Advanced Workforce Management and Scheduling System**

Staff Scheduler is a comprehensive enterprise solution for intelligent workforce management. Built with modern technologies and inspired by constraint programming approaches, it provides powerful tools for shift planning, employee management, and schedule optimization.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-18.2.0-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.1.6-blue.svg)

## 🌟 Key Features

### 🎯 Intelligent Schedule Optimization
- **Advanced constraint-based optimization** inspired by academic research
- Automatic management of hard constraints (must satisfy) and soft constraints (preferences)
- Intelligent workload balancing across teams
- Respects employee availability, skills, and preferences
- Multi-objective optimization with configurable weights

### 👥 Comprehensive Personnel Management
- Detailed employee profiles with skills, certifications, and proficiency levels
- Multi-department organizational structure
- Role-based access control (Admin, Manager, Employee)
- Skill matrix management and tracking
- Employee availability and time-off management

### 📊 Real-Time Dashboard and Analytics
- Interactive dashboard with live metrics and KPIs
- Department-wise statistics and performance indicators
- Shift coverage visualization
- Assignment status tracking
- Export capabilities for reports

### 🔒 Enterprise-Grade Security
- JWT authentication with secure token management
- Bcrypt password hashing (12 rounds)
- Role-based access control (RBAC)
- Session management with 7-day expiration
- Protected API endpoints with middleware authentication

### 🎨 Modern User Interface
- Responsive React SPA built with TypeScript
- Mobile-friendly design
- Intuitive shift management interface
- Real-time updates and notifications
- Professional Bootstrap 5 styling

### 🛠️ Robust Backend Architecture
- RESTful API built with Express.js and TypeScript
- Service layer pattern with comprehensive business logic
- MySQL database with optimized schema
- Transaction support with proper rollback handling
- Extensive logging with Winston
- Input validation with express-validator

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **MySQL** >= 8.0
- **npm** >= 9.0.0

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/lucaosti/StaffScheduler.git
cd StaffScheduler
```

#### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your MySQL credentials

# Initialize database
npm run db:init

# Optional: Install demo data
npm run demo:install

# Start backend server
npm run dev
```

Backend will be running at: http://localhost:3001

#### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start frontend development server
npm start
```

Frontend will be running at: http://localhost:3000

### Default Credentials

After running `npm run db:init`, you can login with:

**Admin Account:**
- Email: `admin@staffscheduler.com`
- Password: `admin123`

**Demo Users** (after `npm run demo:install`):
- Manager: `sarah.johnson@demo.staffscheduler.com` / `demo123`
- Employee: Any demo user email / `demo123`

⚠️ **Important**: Change these passwords in production!

## 🧠 Schedule Optimization with OR-Tools

Staff Scheduler uses **Google OR-Tools CP-SAT solver** for intelligent schedule optimization, inspired by the constraint programming approach from [PoliTO_Timetable_Allocator](https://github.com/Paolino01/PoliTO_Timetable_Allocator).

### Setup Python Environment

The optimizer requires Python 3.8+ with OR-Tools:

```bash
# Install Python dependencies
cd backend
pip3 install -r optimization-scripts/requirements.txt

# Verify installation
python3 optimization-scripts/schedule_optimizer.py --help
```

### How It Works

1. **Constraint Programming Model**: Uses CP-SAT (Constraint Programming - Satisfiability) to find optimal staff assignments
2. **Hard Constraints**: Coverage requirements, no double-booking, skills matching, availability
3. **Soft Constraints**: Employee preferences (correlations), workload fairness, consecutive days limits
4. **Weighted Objective**: Maximizes preferences while respecting all hard constraints

### Optimization Features

- ✅ **Automatic shift coverage** with min-max staff requirements
- ✅ **Skill-based matching** - only qualified staff assigned
- ✅ **Availability respect** - no assignments when employee unavailable
- ✅ **Max hours per week** - respects employee hour limits
- ✅ **Preference optimization** - considers employee shift preferences (like PoliTO correlations)
- ✅ **Workload balancing** - fair distribution of hours across team
- ✅ **Rest period enforcement** - minimum hours between shifts
- ✅ **Consecutive days limits** - prevents burnout with day-off patterns

### Constraint Weights (Configurable)

Inspired by PoliTO's `Parameters.py` approach:

| Constraint | Weight | Priority | Similar to PoliTO |
|------------|--------|----------|-------------------|
| Shift Coverage | 100 | Critical | `teaching_coverage_penalty` |
| No Double-Booking | 90 | Critical | N/A |
| Skill Requirements | 85 | High | `teaching_competency` |
| Availability | 80 | High | `teacher_availability` |
| Max Hours/Week | 75 | High | `max_teaching_hours` |
| Employee Preferences | 55 | Medium | `teaching_overlaps_penalty: 50` |
| Workload Fairness | 40 | Medium | N/A |
| Consecutive Days | 30 | Low | `lecture_dispersion_penalty: 25` |

### Usage Example

```typescript
import scheduleOptimizer from './optimization/ScheduleOptimizerORTools';

// Run optimization
const result = await scheduleOptimizer.optimize({
  shifts: shiftsData,
  employees: employeesData,
  preferences: preferencesData
}, {
  timeLimitSeconds: 300,  // 5 minutes max
  weights: {
    employeePreferences: 60,  // Increase preference weight
    workloadFairness: 45
  }
});

// Check result
if (result.status === 'OPTIMAL') {
  console.log(`Found optimal solution with ${result.assignments.length} assignments`);
  console.log(`Coverage: ${result.statistics.coverageStats.coveragePercentage}%`);
}
```

For more details, see [`backend/optimization-scripts/README.md`](./backend/optimization-scripts/README.md).

## 📁 Project Structure

```
StaffScheduler/
├── backend/                      # Node.js/Express/TypeScript REST API
│   ├── src/
│   │   ├── config/              # Configuration (database, logger)
│   │   ├── middleware/          # Express middleware (auth, validation)
│   │   ├── routes/              # API endpoint definitions
│   │   ├── services/            # Business logic layer (9 services)
│   │   │   ├── UserService.ts
│   │   │   ├── AuthService.ts
│   │   │   ├── DepartmentService.ts
│   │   │   ├── ShiftService.ts
│   │   │   ├── ScheduleService.ts
│   │   │   ├── AssignmentService.ts
│   │   │   ├── SkillService.ts
│   │   │   ├── EmployeeService.ts
│   │   │   └── SystemSettingsService.ts
│   │   ├── optimization/        # Schedule optimization engine
│   │   ├── types/               # TypeScript type definitions
│   │   └── utils/               # Utility functions
│   ├── database/
│   │   └── init.sql            # Complete database schema
│   ├── scripts/
│   │   ├── init-database.ts    # Database initialization
│   │   └── demo-data.ts        # Demo data management
│   ├── .env                     # Environment configuration
│   └── package.json
│
├── frontend/                     # React/TypeScript SPA
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── contexts/            # React Context (AuthContext, etc.)
│   │   ├── pages/               # Application pages
│   │   ├── services/            # API client services
│   │   └── types/               # TypeScript interfaces
│   ├── public/
│   └── package.json
│
├── mysql/                        # MySQL Docker configuration
│   └── conf.d/
│       └── custom.cnf
│
├── API_DOCUMENTATION.md          # Complete API reference
├── TECHNICAL.md                  # Technical architecture guide
├── CONTRIBUTING.md               # Contribution guidelines
├── docker-compose.yml            # Docker orchestration
└── *.sh                          # Management scripts
```

## 🛠️ Available Commands

### Backend Commands

```bash
# Development
npm run dev                # Start development server with hot reload
npm run build              # Build TypeScript to JavaScript
npm run start              # Start production server

# Database Management
npm run db:init            # Initialize database with schema and admin user
npm run demo:install       # Install demo data (50 users, 5 departments, 150+ shifts)
npm run demo:remove        # Remove all demo data
npm run demo:report        # Show demo data statistics

# Testing and Quality
npm test                   # Run test suite
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Generate coverage report
npm run lint               # Check code quality
npm run lint:fix           # Fix linting issues

# Utilities
npm run clean              # Remove build artifacts
```

### Frontend Commands

```bash
npm start                  # Start development server
npm run build              # Build production bundle
npm test                   # Run tests
npm run eject              # Eject from Create React App (irreversible)
```

### Docker Commands

```bash
# From project root
./start.sh                 # Start all services with Docker
./start-dev.sh             # Start in development mode
./stop.sh                  # Stop all containers
./build.sh                 # Build Docker images
./maintenance.sh           # Interactive maintenance menu
```

## 📚 Core Features Deep Dive

### 🗓️ Shift Management
- **Flexible Scheduling**: Create shifts with custom start/end times
- **Shift Templates**: Reusable templates for recurring shift patterns
- **Multi-Department Support**: Organize shifts by department
- **Status Tracking**: Monitor shift lifecycle (open, assigned, confirmed, cancelled)
- **Minimum/Maximum Staff**: Define capacity constraints per shift
- **Skill Requirements**: Specify required skills for each shift

### 👤 Employee Management
- **Comprehensive Profiles**: Store employee details, contact info, and employment data
- **Skills Matrix**: Track employee skills with proficiency levels
- **Department Assignments**: Assign employees to one or multiple departments
- **Availability Management**: Track employee time-off and unavailability periods
- **Role-Based Access**: Three-tier access control (Admin, Manager, Employee)
- **Active/Inactive Status**: Soft delete functionality for historical tracking

### 📅 Schedule Management
- **Draft/Published Workflow**: Create schedules in draft mode before publishing
- **Date Range Planning**: Define schedule start and end dates
- **Schedule Cloning**: Duplicate successful schedules for future periods
- **Shift Integration**: Manage all shifts within a schedule context
- **Archive Functionality**: Archive old schedules while preserving data
- **Statistics Dashboard**: View coverage, assignments, and utilization metrics

### 🎯 Assignment Management
- **Conflict Detection**: Prevent overlapping assignments automatically
- **Availability Checking**: Validate employee availability before assignment
- **Skill Matching**: Ensure assigned employees have required skills
- **Status Workflow**: Track assignment lifecycle (pending, confirmed, cancelled, completed)
- **Bulk Operations**: Assign multiple employees or create multiple assignments efficiently
- **Assignment History**: Complete audit trail of all assignments

### 💡 Skills System
- **Skill Categories**: Organize skills by type (technical, communication, leadership, etc.)
- **User-Skill Associations**: Track which employees possess which skills
- **Shift Requirements**: Define required skills for each shift
- **Skill-Based Filtering**: Find available employees with specific skill sets
- **Active/Inactive Management**: Maintain skill inventory over time

### ⚙️ System Settings
- **Currency Configuration**: Support for EUR/USD
- **Time Period Defaults**: Configure default scheduling periods (monthly/weekly/daily)
- **Constraint Parameters**: Configurable scheduling rules (max shifts per week, min hours between shifts)
- **User Preferences**: Store application-wide configuration settings
- **Editable/Protected Settings**: Control which settings users can modify

## 🔧 Configuration

### Backend Environment Variables (.env)

```env
# Server Configuration
NODE_ENV=development
PORT=3001
HOST=localhost

# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=staff_scheduler

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION=7d

# Security
BCRYPT_ROUNDS=12

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# CORS Configuration
CORS_ORIGIN=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Frontend Environment Variables

```env
# API Configuration
REACT_APP_API_URL=http://localhost:3001
REACT_APP_API_TIMEOUT=30000

# Application Configuration
REACT_APP_NAME=Staff Scheduler
REACT_APP_VERSION=1.0.0
```

## 🧪 Testing

### Backend Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run integration tests only
npm run test:integration

# Run optimization tests
npm run test:optimization
```

### Test Structure

```
backend/src/__tests__/
├── services/           # Service layer unit tests
├── routes/             # API endpoint integration tests
├── optimization/       # Optimization algorithm tests
└── setup.ts            # Test configuration
```

## � Documentation

For detailed information, refer to:

- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Complete REST API reference with all endpoints
- **[TECHNICAL.md](./TECHNICAL.md)** - Technical architecture and implementation details
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines and development workflow

## 🏗️ Technology Stack

### Backend
- **Runtime**: Node.js >= 18.0.0
- **Framework**: Express.js 4.18.2
- **Language**: TypeScript 5.1.6
- **Database**: MySQL 8.0
- **ORM/Query**: mysql2 3.6.0 (connection pooling)
- **Authentication**: JWT (jsonwebtoken 9.0.2), bcrypt 5.1.0
- **Validation**: express-validator 7.0.1
- **Logging**: Winston 3.11.0
- **Optimization**: Python 3.8+ with Google OR-Tools >= 9.8.0 (CP-SAT solver)
- **Testing**: Jest 29.7.0, Supertest 6.3.3
- **Documentation**: JSDoc, Swagger (planned)

### Frontend
- **Framework**: React 18.2.0
- **Language**: TypeScript 4.9.5
- **HTTP Client**: Axios
- **Routing**: React Router v6
- **State Management**: React Context API
- **UI Framework**: Bootstrap 5
- **Build Tool**: Create React App / Webpack

### Database Schema
- **Tables**: 11 core tables (users, departments, shifts, schedules, assignments, skills, etc.)
- **Constraints**: Foreign keys, unique constraints, indexes
- **Features**: Soft deletes, timestamps, enum types
- **Size**: Optimized for 100K+ records

### DevOps
- **Containerization**: Docker, Docker Compose
- **Version Control**: Git
- **CI/CD**: GitHub Actions (planned)
- **Monitoring**: Winston logging, error tracking

## 🚦 API Overview

The REST API provides comprehensive endpoints for all operations:

### Authentication & Users
- `POST /api/auth/login` - User authentication
- `POST /api/auth/refresh` - Token refresh
- `GET/POST/PUT/DELETE /api/users` - User management
- `GET /api/users/statistics` - User statistics

### Departments
- `GET/POST/PUT/DELETE /api/departments` - Department CRUD
- `POST /api/departments/:id/employees` - Assign employees
- `GET /api/departments/:id/stats` - Department statistics

### Schedules
- `GET/POST/PUT/DELETE /api/schedules` - Schedule management
- `POST /api/schedules/:id/publish` - Publish schedule
- `POST /api/schedules/:id/duplicate` - Clone schedule
- `GET /api/schedules/:id/shifts` - Get schedule shifts

### Shifts
- `GET/POST/PUT/DELETE /api/shifts` - Shift management
- `GET /api/shifts/templates` - Shift templates
- `POST /api/shifts/from-template` - Create from template
- `GET /api/shifts/by-department/:id` - Department shifts

### Assignments
- `GET/POST/PUT/DELETE /api/assignments` - Assignment management
- `POST /api/assignments/:id/confirm` - Confirm assignment
- `POST /api/assignments/:id/cancel` - Cancel assignment
- `GET /api/assignments/available-employees/:shiftId` - Get available staff

### Skills
- `GET/POST/PUT/DELETE /api/skills` - Skill management
- `GET /api/skills/:id/users` - Users with skill
- `GET /api/skills/statistics` - Skill analytics

### System Settings
- `GET/PUT /api/settings` - System configuration
- `GET/PUT /api/settings/currency` - Currency settings
- `GET/PUT /api/settings/time-period` - Time period defaults

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete endpoint details.

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the Repository**
   ```bash
   git fork https://github.com/lucaosti/StaffScheduler.git
   ```

2. **Create a Feature Branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make Your Changes**
   - Write clean, documented code
   - Follow the existing code style
   - Add tests for new features
   - Update documentation as needed

4. **Commit Your Changes**
   ```bash
   git commit -m "feat: add amazing feature"
   ```

5. **Push to Your Fork**
   ```bash
   git push origin feature/amazing-feature
   ```

6. **Open a Pull Request**
   - Provide a clear description of changes
   - Reference any related issues
   - Ensure all tests pass

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines including:
- Code style guide
- Testing requirements
- Documentation standards
- Review process

## � Known Issues & Roadmap

### Current Limitations
- Frontend is under development (React components need implementation)
- Optimization algorithm needs constraint weighting enhancements
- Demo data script is basic (needs expansion)
- Test coverage can be improved

### Roadmap
- ✅ Complete backend API with 9 services
- ✅ Database schema with 11 tables
- ✅ Authentication and authorization
- 🔄 Frontend React components (in progress)
- 🔄 Schedule optimization algorithm (in progress)
- ⏳ Comprehensive test coverage
- ⏳ Email notifications
- ⏳ Mobile app (React Native)
- ⏳ Advanced reporting and analytics
- ⏳ Integration with external HR systems

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for full details.

```
MIT License

Copyright (c) 2025 Luca Ostinelli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

## 👨‍💻 Authors & Contributors

**Lead Developer:** Luca Ostinelli
- GitHub: [@lucaosti](https://github.com/lucaosti)
- Email: luca.ostinelli@example.com

**Academic Inspiration:** PoliTO_Timetable_Allocator (constraint programming approach)

## 🙏 Acknowledgments

- **PoliTO_Timetable_Allocator** - For the constraint-based scheduling approach
- **React Team** - For the amazing frontend framework
- **Express.js Community** - For the robust backend framework
- **TypeScript Team** - For type safety and developer experience
- **MySQL Community** - For the reliable database system
- **Bootstrap Team** - For the responsive UI components
- **Jest & Testing Library** - For comprehensive testing tools
- **All Open Source Contributors** - For making this possible

## 📞 Support & Contact

### Getting Help
- **Documentation**: Start with this README and linked docs
- **Issues**: [GitHub Issues](https://github.com/lucaosti/StaffScheduler/issues)
- **Discussions**: [GitHub Discussions](https://github.com/lucaosti/StaffScheduler/discussions)

### Reporting Bugs
Please open an issue with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Screenshots if applicable

### Feature Requests
We're always looking to improve! Submit feature requests via:
- GitHub Issues with `enhancement` label
- Provide use case and expected behavior
- Consider contributing the feature yourself!

---

<div align="center">

**Staff Scheduler** - Professional Workforce Management

Made with ❤️ by Luca Ostinelli

⭐ Star us on GitHub — it helps!

[Report Bug](https://github.com/lucaosti/StaffScheduler/issues) · [Request Feature](https://github.com/lucaosti/StaffScheduler/issues) · [Documentation](./API_DOCUMENTATION.md)

</div>
