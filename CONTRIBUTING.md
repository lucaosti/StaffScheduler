# CONTRIBUTING - Staff Scheduler Development Guidelines

> **Comprehensive development standards, code guidelines, testing requirements, and contribution process for Staff Scheduler project**

**Table of Contents:**
1. [Code of Conduct](#code-of-conduct)
2. [Security Policy](#security-policy)
3. [Getting Started](#getting-started)
4. [Code Standards](#code-standards)
5. [Development Workflow](#development-workflow)
6. [Testing Requirements](#testing-requirements)
7. [Git Workflow & PR Process](#git-workflow--pr-process)
8. [Code Review Guidelines](#code-review-guidelines)
9. [Performance Benchmarks](#performance-benchmarks)
10. [Security Requirements](#security-requirements)
11. [Pre-commit Hooks & Linting](#pre-commit-hooks--linting)
12. [Commit Message Standards](#commit-message-standards)

---

## CODE OF CONDUCT

This project follows the spirit of the
[Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

In short:

- Be respectful, welcoming, and inclusive.
- Assume good faith and prefer constructive feedback over personal
  criticism.
- Harassment of any kind is not tolerated, in issues, pull requests,
  commit messages, or any other project space.
- Reports of unacceptable behavior can be sent privately to the
  maintainer (see [Security Policy](#security-policy) for the address).
  Reports are handled confidentially.

By contributing — opening issues, submitting pull requests, or reviewing
others' work — you agree to abide by these expectations.

---

## SECURITY POLICY

### Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Instead, contact the maintainer privately at
[lucaostinelli@protonmail.com](mailto:lucaostinelli@protonmail.com) with:

- a description of the vulnerability,
- steps to reproduce it (proof of concept welcome),
- the affected version / commit SHA,
- and your assessment of the impact.

You should expect an acknowledgement within **5 business days** and a
status update within **15 business days**. Coordinated disclosure
windows are negotiated case-by-case; the default is 90 days from the
acknowledgement before public disclosure, shorter if a fix is available
sooner.

### Supported versions

The project is pre-1.0 and does not maintain back-ported security
branches. Fixes ship on `main`; users are expected to track the latest
release.

### Scope

In scope:

- The HTTP API (`backend/src/routes/**`) and the services it exposes.
- The web frontend (`frontend/src/**`) when built with the documented
  configuration.
- The OR-Tools optimizer bridge (`backend/optimization-scripts/**`).

Out of scope:

- Vulnerabilities that require an attacker who already has admin
  credentials in the application.
- Vulnerabilities in third-party services (MySQL, Docker, OS, browser).
- Findings against forks or unsupported deployments (e.g. running
  behind a misconfigured reverse proxy).

---

## GETTING STARTED

### Prerequisites

- **Node.js**: 18.0.0 or higher (LTS recommended)
- **npm**: 9.0.0 or higher
- **Docker Desktop**: 4.0+ with Docker Compose V2
- **Git**: 2.37.0 or higher
- **VS Code** (recommended) with recommended extensions:
  - ESLint (`dbaeumer.vscode-eslint`)
  - Prettier (`esbenp.prettier-vscode`)
  - Jest Runner (`firsttris.vscode-jest-runner`) for inline test runs
  - Thunder Client / REST Client for API testing

### Initial Setup

```bash
# Clone repository
git clone https://github.com/lucaosti/StaffScheduler.git
cd StaffScheduler

# Install dependencies (backend)
cd backend
npm install

# Install dependencies (frontend)
cd ../frontend
npm install

# Return to root
cd ..

# Start development environment (mysql + phpmyadmin under the dev profile)
docker compose --profile dev up -d

# Initialize database schema (no demo data)
cd backend
npm run db:init

# Optional: seed a demo dataset (idempotent)
npm run db:seed:demo

# Start backend (terminal 1)
npm run dev

# Start frontend (terminal 2, from frontend dir)
npm start

# Access:
# Frontend: http://localhost:3000
# Backend API: http://localhost:3001/api
# Swagger UI: http://localhost:3001/api/docs
# PhpMyAdmin: http://localhost:8080
```

### IDE Configuration

**VS Code settings.json:**
```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.tsserver.maxTsServerMemory": 2048,
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.codeActionsOnSave": {
      "source.fixAll.eslint": true
    }
  },
  "eslint.validate": ["javascript", "typescript"],
  "eslint.format.enable": true
}
```

---

## CODE STANDARDS

### TypeScript Configuration

**Required Rules (strict mode):**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### Naming Conventions

```typescript
// Files
- /components/Header.tsx (PascalCase for React components)
- /services/authService.ts (camelCase for services)
- /types/index.ts (lowercase for utility)
- /utils/math.ts (lowercase for utilities)

// Classes & Interfaces
class ScheduleOptimizer { }        // PascalCase
interface UserData { }              // PascalCase
type ScheduleStatus = 'draft';      // PascalCase

// Variables & Functions
const maxIterations = 10000;        // camelCase
const API_TIMEOUT = 5000;           // UPPER_SNAKE_CASE (constants)
function calculateCost() { }        // camelCase
const getUserById = (id) => { };    // camelCase arrow functions

// React Components
const Dashboard: React.FC = () => { };       // PascalCase
const useSchedule = () => { };               // camelCase hooks

// Database Fields
employee_id VARCHAR(50)             // snake_case
start_date DATE                     // snake_case
```

### Indentation & Formatting

```typescript
// 2-space indentation (enforced by Prettier)
function example() {
  const data = {
    key: 'value',
    nested: {
      property: true,
    },
  };
}

// Line length: 100 characters (Prettier default)
// Trailing commas: es5 (Prettier)
// Semicolons: Always
// Quotes: Single quotes in JS, double in JSON/HTML
```

### Import Organization

```typescript
// 1. External dependencies (alphabetical)
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';

// 2. Internal absolute imports (alphabetical)
import { ScheduleService } from '@services/ScheduleService';
import { useAuth } from '@contexts/AuthContext';
import { API_BASE_URL } from '@config/api';

// 3. Internal relative imports (alphabetical)
import { EmployeeList } from '../components/EmployeeList';
import { formatDate } from '../../utils/date';

// 4. Side effects (absolute, then relative)
import '@styles/dashboard.css';
import '../styles/local.css';
```

### Function Documentation

```typescript
/**
 * Generates an optimized schedule using hybrid constraint programming
 * 
 * @param scheduleId - The ID of the schedule to generate
 * @param employees - Array of available employees with skills
 * @param shifts - Array of shifts to fill
 * @param constraints - Constraint configuration object
 * @returns Promise resolving to generated assignments with metrics
 * @throws ScheduleGenerationError if optimization fails
 * 
 * @example
 * const assignments = await generateSchedule(
 *   123,
 *   employees,
 *   shifts,
 *   { maxIterations: 10000, timeout: 300 }
 * );
 * 
 * Performance: O(n·m·log k + I·n·m) where I = iterations
 * Typical runtime: 2-10 seconds for 100 employees, 500 shifts
 */
async function generateSchedule(
  scheduleId: number,
  employees: Employee[],
  shifts: Shift[],
  constraints: ConstraintConfig
): Promise<Assignment[]> {
  // Implementation
}
```

### Type Safety

```typescript
// ✓ CORRECT: Explicit typing everywhere
interface ScheduleRequest {
  name: string;
  department_id: number;
  start_date: Date;
  end_date: Date;
}

function createSchedule(data: ScheduleRequest): Promise<Schedule> {
  // Type-safe
}

// ✗ WRONG: Implicit any types
function createSchedule(data: any): any {
  // Forbidden
}

// ✓ CORRECT: Strict null checks
const value: string | null = getData();
if (value !== null) {
  console.log(value.length); // Type-safe
}

// ✗ WRONG: Non-null assertion
const value: string | null = getData();
console.log(value!.length); // Forbidden (except type narrowing required)
```

### Error Handling

```typescript
// ✓ CORRECT: Custom error classes
class ScheduleGenerationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ScheduleGenerationError';
  }
}

try {
  await generateSchedule(...);
} catch (error) {
  if (error instanceof ScheduleGenerationError) {
    logger.error('Schedule generation failed', {
      code: error.code,
      details: error.details,
    });
  }
}

// ✓ CORRECT: Promise rejections
function readFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (err, data) => {
      if (err) reject(new Error(`Failed to read ${path}`));
      else resolve(data.toString());
    });
  });
}

// ✗ WRONG: Swallowing errors
try {
  await risky();
} catch (e) {
  // Silent failure - forbidden
}
```

---

## DEVELOPMENT WORKFLOW

### Creating a Feature Branch

```bash
# 1. Update main branch
git checkout main
git pull origin main

# 2. Create feature branch with descriptive name
git checkout -b feature/add-schedule-optimization
git checkout -b fix/double-booking-bug
git checkout -b docs/api-endpoints

# 3. Branch naming conventions:
# feature/{descriptive-name}    - New features
# fix/{descriptive-name}        - Bug fixes
# docs/{descriptive-name}       - Documentation
# refactor/{descriptive-name}   - Code refactoring
# test/{descriptive-name}       - Test additions
# perf/{descriptive-name}       - Performance improvements
```

### Making Changes

```bash
# 1. Make small, focused commits
git add src/services/ScheduleService.ts
git commit -m "feat(schedule): add generateOptimized method"

# 2. Run tests before committing
npm run test
npm run lint

# 3. Update documentation if needed
# - Update README.md for user-facing changes
# - Update TECHNICAL.md for architecture changes
# - Add inline comments for complex logic

# 4. Push to remote
git push origin feature/add-schedule-optimization
```

### Development Best Practices

**Single Responsibility Principle:**
```typescript
// ✓ CORRECT: Separated concerns
class ScheduleService {
  async generateSchedule(id: number): Promise<void> {
    const schedule = await this.repository.findById(id);
    const assignments = this.optimizer.optimize(schedule);
    await this.repository.saveAssignments(assignments);
  }
}

class ScheduleOptimizer {
  optimize(schedule: Schedule): Assignment[] {
    // Pure optimization logic only
  }
}

// ✗ WRONG: Mixed concerns
class ScheduleService {
  async generateSchedule(id: number): Promise<void> {
    // Database queries
    // Business logic
    // Optimization
    // All mixed together
  }
}
```

**DRY (Don't Repeat Yourself):**
```typescript
// ✓ CORRECT: Reusable utility
function formatTime(date: Date, format: string): string {
  // Centralized time formatting
}

const start = formatTime(new Date(), 'HH:mm');
const end = formatTime(new Date(), 'HH:mm');

// ✗ WRONG: Repeated logic
const start = new Date().toLocaleTimeString('en-US', { 
  hour: '2-digit', 
  minute: '2-digit' 
});
const end = new Date().toLocaleTimeString('en-US', { 
  hour: '2-digit', 
  minute: '2-digit' 
});
```

**Composition Over Inheritance:**
```typescript
// ✓ CORRECT: Composition
class ScheduleOptimizer {
  constructor(
    private validator: ConstraintValidator,
    private calculator: CostCalculator,
    private annealer: SimulatedAnnealer
  ) { }
}

// ✗ WRONG: Deep inheritance hierarchies
class Optimizer extends Algorithm {
  // ...
}
class ScheduleOptimizer extends Optimizer {
  // ...
}
```

---

## TESTING REQUIREMENTS

### Test Coverage Minimum

- **Backend**: 80% coverage required
- **Frontend**: 70% coverage required (UI components can be lower)
- **Critical paths**: 95%+ coverage required

### Test Structure

```typescript
// File: backend/__tests__/ScheduleOptimizer.test.ts

import { ScheduleOptimizer } from '../src/optimization/ScheduleOptimizer';
import { Employee, Shift, Constraint } from '../src/types';

describe('ScheduleOptimizer', () => {
  let optimizer: ScheduleOptimizer;
  let mockEmployees: Employee[];
  let mockShifts: Shift[];

  beforeEach(() => {
    optimizer = new ScheduleOptimizer();
    mockEmployees = createMockEmployees(100);
    mockShifts = createMockShifts(500);
  });

  describe('greedy initialization', () => {
    it('should create feasible initial solution', () => {
      const result = optimizer.greedyInit(mockEmployees, mockShifts);
      
      expect(result).toBeDefined();
      expect(result.assignments.length).toBeGreaterThan(0);
      expect(result.cost).toBeLessThan(Infinity);
    });

    it('should respect hard constraints', () => {
      const result = optimizer.greedyInit(mockEmployees, mockShifts);
      
      expect(hasNoDoubleBookings(result)).toBe(true);
      expect(allSkillsMatched(result)).toBe(true);
    });

    it('should handle insufficient staff gracefully', () => {
      const limitedEmployees = mockEmployees.slice(0, 10);
      const result = optimizer.greedyInit(limitedEmployees, mockShifts);
      
      expect(result.violations).toBeDefined();
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe('simulated annealing', () => {
    it('should improve cost over iterations', () => {
      const initial = optimizer.greedyInit(mockEmployees, mockShifts);
      const optimized = optimizer.anneal(initial, { 
        maxIterations: 1000 
      });
      
      expect(optimized.cost).toBeLessThanOrEqual(initial.cost);
    });

    it('should respect timeout constraint', async () => {
      const config = { timeout_seconds: 1 };
      const start = Date.now();
      
      const result = await optimizer.anneal(initial, config);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeLessThan(1100); // 100ms margin
    });
  });

  describe('edge cases', () => {
    it('should handle empty employee list', () => {
      expect(() => {
        optimizer.greedyInit([], mockShifts);
      }).toThrow();
    });

    it('should handle mismatched skills', () => {
      const unqualified = mockEmployees.map(e => ({
        ...e,
        skills: [] // No skills
      }));
      
      const result = optimizer.greedyInit(unqualified, mockShifts);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });
});
```

### Running Tests

```bash
# Backend tests
cd backend
npm test                       # Run unit + integration suites
npm run test:watch             # Watch mode
npm run test:coverage          # Generate coverage report
npm run test:integration       # Run only *.integration.test.ts files
npm test -- --testNamePattern="ScheduleOptimizer"   # Specific test

# Frontend tests (CRA / react-scripts)
cd frontend
CI=true npm test -- --watchAll=false                # Run once
CI=true npm test -- --watchAll=false --coverage     # With coverage

# End-to-end (Playwright, requires the demo stack to be running)
cd frontend
npm run test:e2e
```

### Test Naming Convention

```typescript
describe('ClassName', () => {
  describe('methodName', () => {
    it('should [expected behavior] when [condition]', () => {
      // Arrange
      const input = createTestData();
      
      // Act
      const result = method(input);
      
      // Assert
      expect(result).toBe(expected);
    });
  });
});

// Example:
// should return valid schedule when all constraints satisfied
// should throw error when insufficient employees
// should improve cost when running annealing
```

---

## GIT WORKFLOW & PR PROCESS

### Branch Protection Rules

- All commits to `main` require PR review
- At least 1 approval required from maintainers
- All CI checks (tests, linting) must pass
- Linear history preferred (rebase before merge)

### Creating a Pull Request

```bash
# 1. Ensure branch is up to date
git fetch origin
git rebase origin/main

# 2. Run full test suite
npm run test
npm run lint
npm run build

# 3. Push to remote
git push origin feature/my-feature

# 4. Create PR on GitHub with detailed description
```

### PR Template

```markdown
## Description
Clear description of changes and motivation.

## Type of Change
- [ ] Bug fix (non-breaking change that fixes issue)
- [ ] Feature (non-breaking change that adds functionality)
- [ ] Breaking change (causes existing functionality to change)
- [ ] Documentation update

## Related Issue
Fixes #123

## How Has This Been Tested?
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Test coverage maintained/improved
```

### Merging Process

```bash
# 1. After approval, rebase on latest main
git fetch origin
git rebase origin/main

# 2. Resolve conflicts if needed
git add .
git rebase --continue

# 3. Force push to PR branch (only your branch)
git push origin feature/my-feature --force-with-lease

# 4. Merge via GitHub UI (squash recommended for single-commit features)
# OR via CLI:
git checkout main
git merge --ff-only feature/my-feature
git push origin main
```

---

## CODE REVIEW GUIDELINES

### Reviewer Responsibilities

**Check for:**
- ✓ Code follows established standards
- ✓ Type safety (no implicit any)
- ✓ Error handling is comprehensive
- ✓ Performance implications considered
- ✓ Security vulnerabilities absent
- ✓ Tests are adequate and meaningful
- ✓ Documentation is clear and complete

**Ask questions about:**
- Why this approach vs alternatives?
- Are there edge cases handled?
- Is this scalable?
- Is error handling sufficient?

**Provide constructive feedback:**
```
// ✓ GOOD: Specific and actionable
Consider using `Array.findIndex()` here instead of a manual loop
for better readability and O(n) performance.

// ✗ POOR: Vague or discouraging
This code is bad. Rewrite it.
```

### Reviewer Tools

```bash
# Run tests locally
git checkout refs/pull/123/head
npm run test
npm run lint

# Check code coverage impact
npm run test:coverage

# Build check
npm run build
```

---

## PERFORMANCE BENCHMARKS

### Backend Endpoints

| Endpoint | Target | Alert |
|----------|--------|-------|
| `GET /api/schedules` | 50ms | > 200ms |
| `GET /api/schedules/:id` | 100ms | > 300ms |
| `POST /api/schedules/:id/generate` | 5s | > 15s |
| `GET /api/employees` | 100ms | > 400ms |
| `GET /api/dashboard/stats` | 500ms | > 2s |

### Optimization Engine

```typescript
// Expected performance
100 employees, 500 shifts:
- Greedy phase: 500ms
- Annealing phase: 2-5s
- Total: 2.5-5.5s

500 employees, 2500 shifts:
- Greedy phase: 1.2s
- Annealing phase: 8-12s
- Total: 9.2-13.2s
```

### Database Queries

```typescript
// Acceptable query times
- Indexed SELECT: < 5ms
- 3-table JOIN: < 50ms
- Aggregation: < 200ms
- Complex queries: < 500ms
```

### Frontend Performance

```typescript
// React component render times
- Simple component: < 16ms
- Complex dashboard: < 200ms
- List with 1000 items: < 500ms

// Bundle sizes
- Main bundle: < 500KB (gzipped)
- Each route chunk: < 200KB (gzipped)
```

### Load Testing

The repository does not currently ship a load-testing harness; before
production deployment you should benchmark the relevant endpoints with a
tool of your choice (e.g. [`k6`](https://k6.io),
[`autocannon`](https://github.com/mcollina/autocannon)) against the
demo dataset.

Targets to aim for on a single node deployment with the demo dataset:

- 100 concurrent users: 95th percentile < 2 s
- 1000 concurrent users: 95th percentile < 5 s
- Error rate: < 0.1%

---

## SECURITY REQUIREMENTS

### Input Validation

```typescript
// ✓ CORRECT: Comprehensive validation
function validateScheduleInput(data: unknown): ScheduleRequest {
  if (!isObject(data)) throw new ValidationError('Invalid input');
  
  const name = assertString(data.name, 1, 255, 'name');
  const startDate = assertDate(data.start_date, 'start_date');
  const endDate = assertDate(data.end_date, 'end_date');
  
  if (startDate >= endDate) {
    throw new ValidationError('start_date must be before end_date');
  }
  
  return { name, start_date: startDate, end_date: endDate };
}

// ✗ WRONG: No validation
function createSchedule(data: any) {
  return db.query(`INSERT INTO schedules VALUES ('${data.name}')`);
}
```

### SQL Injection Prevention

```typescript
// ✓ CORRECT: Parameterized queries
const result = await db.query(
  'SELECT * FROM employees WHERE department_id = ?',
  [departmentId]
);

// ✗ WRONG: String interpolation
const result = await db.query(
  `SELECT * FROM employees WHERE department_id = ${departmentId}`
);
```

### Authentication & Authorization

```typescript
// ✓ CORRECT: Token verification + permission check
async function updateSchedule(id: number, data: any, user: User) {
  const schedule = await getSchedule(id);
  
  // Verify permission
  if (!canManage(schedule.department_id, user)) {
    throw new ForbiddenError('Insufficient permissions');
  }
  
  // Verify token not expired
  if (!isTokenValid(user.token)) {
    throw new UnauthorizedError('Token expired');
  }
  
  return update(schedule, data);
}

// ✗ WRONG: No permission check
async function updateSchedule(id: number, data: any) {
  return update(await getSchedule(id), data);
}
```

### Password Security

```typescript
// ✓ CORRECT: Strong hashing with salt
const hashedPassword = await bcrypt.hash(password, 12);
const isValid = await bcrypt.compare(input, hashedPassword);

// ✗ WRONG: Plain text or weak hashing
const hashedPassword = sha1(password); // Never use SHA1
```

### Secret Management

```bash
# ✓ CORRECT: Environment variables
export JWT_SECRET=$(openssl rand -base64 32)
export DB_PASSWORD=$(openssl rand -base64 16)

# ✗ WRONG: Hardcoded secrets
const JWT_SECRET = 'my-secret-key'; // Never hardcode
```

### CORS Configuration

```typescript
// ✓ CORRECT: Restricted origins
app.use(cors({
  origin: process.env.CORS_ORIGIN, // Only allowed origin
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ✗ WRONG: Unrestricted CORS
app.use(cors({ origin: '*' })); // Allows anyone
```

### Dependency Security

```bash
# Regular audits
npm audit                  # Check for vulnerabilities
npm audit fix              # Auto-fix if possible
npm update                 # Keep dependencies current

# Lock file integrity
npm ci                     # Use exact versions from package-lock.json
```

---

## PRE-COMMIT HOOKS & LINTING

### ESLint Configuration

**File: `.eslintrc.json`**
```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier"
  ],
  "plugins": ["@typescript-eslint"],
  "rules": {
    "no-implicit-any": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-types": "warn",
    "no-console": "warn"
  }
}
```

### Prettier Configuration

**File: `.prettierrc.json`**
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "always"
}
```

### Pre-commit Hooks

The repository does **not** ship a Husky / lint-staged setup today —
gating happens in CI (`.github/workflows/ci.yml`) which runs lint +
test + build on every push and PR. If you want a local pre-commit
parity, you can opt in with:

```bash
# From the repo root
npm install --save-dev husky
npx husky init
echo "cd backend && npm run lint && cd ../frontend && npm run lint" \
  > .husky/pre-commit
chmod +x .husky/pre-commit
```

This is purely local; nothing in the repo depends on it.

### Running Linters

```bash
# Backend
cd backend
npm run lint                   # ESLint
npm run lint:fix              # Auto-fix fixable errors
npm run build                 # tsc --noEmit-equivalent (full build)

# Frontend
cd frontend
npm run lint                   # ESLint
npm run lint:fix              # Auto-fix fixable errors
CI=true npm run build          # Production build (acts as type check)
```

---

## COMMIT MESSAGE STANDARDS

### Commit Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type Convention

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (formatting)
- `refactor`: Code change that neither fixes bug nor adds feature
- `perf`: Code change that improves performance
- `test`: Adding missing tests or updating tests
- `chore`: Changes to build process or dependencies
- `ci`: Changes to CI configuration files and scripts

### Scope Convention

- `schedule`: Scheduling related
- `employee`: Employee management
- `optimization`: Optimization engine
- `auth`: Authentication & authorization
- `api`: API endpoints
- `db`: Database changes
- `ui`: Frontend components

### Examples

```bash
# Feature commit
git commit -m "feat(schedule): add generateOptimized method with simulated annealing"

# Bug fix
git commit -m "fix(auth): prevent double login attempts on rate limit"

# Documentation
git commit -m "docs(api): update schedule generation endpoint documentation"

# Performance
git commit -m "perf(optimization): optimize greedy initialization from O(n²) to O(n log n)"

# Refactor
git commit -m "refactor(services): extract constraint validation to separate class"

# With body
git commit -m "feat(optimization): add soft constraints for workload fairness

- Implement workload variance calculation
- Add preference satisfaction scoring
- Update objective function documentation

Closes #123"
```

### Commit Message Guidelines

```
✓ Use imperative mood ("add" not "added" or "adds")
✓ Limit first line to 50 characters
✓ Reference issues and pull requests liberally after first paragraph
✓ Explain what and why, not how
✓ Keep commits atomic and focused
✓ Provide context in commit body

✗ Generic messages ("update", "fix bug")
✗ All lowercase
✗ Multiple unrelated changes in one commit
```

---

## Checking Your Work Before Submitting

```bash
# Backend (run from ./backend)
npm run lint
npm test
npm run build

# Frontend (run from ./frontend)
npm run lint
CI=true npm test -- --watchAll=false
CI=true npm run build

# Optional: e2e against a running demo stack (./scripts/demo.sh up)
cd frontend && npm run test:e2e

# Review your changes
git diff main...HEAD

# Verify commit messages
git log --oneline -5

# Push to branch
git push origin feature/my-feature
```

---

## Questions or Need Help?

- **Development Issues**: Create GitHub issue with `help wanted` label
- **Code Questions**: Ask in PR comments
- **Security Issues**: see the [Security Policy](#security-policy) above
- **Documentation**: Update relevant files and submit PR

---

**Maintained by:** [@lucaosti](https://github.com/lucaosti)
