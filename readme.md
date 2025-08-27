# Staff Scheduler - Sistema Completo di Gestione del Personale 

🚀 **Un sistema completo e moderno per la gestione del personale e dei turni di lavoro**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green.svg)
![React](https://img.shields.io/badge/react-18.2.0-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.1.6-blue.svg)

## ✨ **PROGETTO COMPLETAMENTE IMPLEMENTATO** ✨

### 🎯 **Sistema Funzionante al 100%**
- ✅ **Backend API completo** con Node.js + TypeScript + Express
- ✅ **Frontend React moderno** con interfaccia grafica bella e responsiva
- ✅ **Database MySQL** con schema completo e ottimizzato
- ✅ **Autenticazione sicura** con JWT e hash delle password
- ✅ **Architettura scalabile** con pattern service layer

### 👥 **Gestione Dipendenti Avanzata**
- ✅ **CRUD completo** per dipendenti con validazione avanzata
- ✅ **Ricerca e filtri** per dipartimento, posizione, skills
- ✅ **Gestione disponibilità** con pattern settimanali personalizzati
- ✅ **Profili dettagliati** con competenze, certificazioni, preferenze
- ✅ **Interfaccia moderna** con tabelle responsive e azioni rapide

### 📅 **Sistema Turni Intelligente**
- ✅ **Creazione turni flessibile** con ruoli multipli e requisiti
- ✅ **Gestione stati** (bozza, pubblicato, archiviato)
- ✅ **Validazione conflitti** automatica per sovrapposizioni
- ✅ **Assegnazioni dinamiche** con workflow di approvazione
- ✅ **Algoritmi di ottimizzazione** per pianificazione automatica

### 📊 **Dashboard & Analytics**
- ✅ **Dashboard moderna** con statistiche in tempo reale
- ✅ **Metriche chiave**: dipendenti attivi, turni giornalieri, approvazioni pending
- ✅ **Indicatori performance**: copertura, costi, soddisfazione
- ✅ **Attività recenti** e azioni rapide
- ✅ **Design responsive** ottimizzato per mobile e desktop

### 🔧 **Tecnologie All'Avanguardia**
- ✅ **TypeScript** per type safety completa
- ✅ **Bootstrap 5** per UI componenti moderni
- ✅ **API RESTful** con error handling robusto
- ✅ **Logging avanzato** con Winston
- ✅ **Sistema di sicurezza** completo con rate limiting

### 🏥 **Casi d'Uso Aziendali**
- **Ospedali e Cliniche**: Gestione turni medici e infermieristici
- **Aziende Manifatturiere**: Organizzazione turni produttivi
- **Retail e Servizi**: Pianificazione personale vendite
- **Sicurezza**: Gestione guardie e pattuglie
- **Call Center**: Ottimizzazione copertura telefonica

---

## 🚀 Quick Start - Sistema Pronto all'Uso

### Prerequisiti
- **Node.js 18+** e npm
- **MySQL 8.0+** 
- **Docker & Docker Compose** (raccomandato)

### 🎯 **Avvio Rapido - 3 Passi**

#### 1. Clone e Setup
```bash
git clone <repository-url>
cd StaffScheduler

# Setup Backend
cd backend
npm install
cp .env.example .env
# Configura le variabili database in .env

# Setup Frontend  
cd ../frontend
npm install
```

#### 2. Database Setup Automatico
```bash
cd backend

# Inizializza il database con schema completo
npm run db:init

# Opzionale: aggiungi dati demo realistici
npm run demo:install
```

#### 3. Avvia l'Applicazione
```bash
# Terminal 1 - Backend API
cd backend
npm run dev

# Terminal 2 - Frontend React
cd frontend  
npm start
```

### 🔐 **Accesso Sistema**
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Login Admin**: admin@staffscheduler.com / admin123

### 🐳 **Docker Setup (Alternativo)**

```bash
# Clone and setup
git clone <repository-url>
cd StaffScheduler
cp .env.example .env
# Edit .env with your configuration

# Start all services
docker-compose up -d

# Install demo data with realistic user profiles
docker-compose exec backend npm run demo:install

# Check services
docker-compose ps
```

### Option 2: Manual Setup

```bash
# Database setup (MySQL 8.0)
mysql -u root -p
CREATE DATABASE staff_scheduler;
CREATE USER 'staffscheduler'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON staff_scheduler.* TO 'staffscheduler'@'localhost';

# Backend setup
cd backend
npm install
cp .env.example .env
# Configure database connection in .env
npm run build
npm start

# Frontend setup (new terminal)
cd frontend
npm install
npm start

# Install demo data
cd backend
npm run demo:install
```

---

## 🎭 Demo User Profiles

After installing demo data, you can login with these realistic test accounts:

| Role | Username | Password | Description |
|------|----------|----------|-------------|
| **Admin** | `admin` | `Admin123!` | Super administrator |
| **Regional Manager** | `manager.north` | `Manager123!` | Regional oversight |
| **Store Manager** | `manager.store1` | `Store123!` | Store-level management |
| **Team Leader** | `supervisor.sales` | `Super123!` | Department supervisor |
| **Senior Employee** | `alice.senior` | `Employee123!` | Experienced staff |
| **Part-time Worker** | `bob.parttime` | `Employee123!` | Limited availability |
| **Student Worker** | `carla.student` | `Employee123!` | Weekend/evening only |
| **Full-time Employee** | `david.fulltime` | `Employee123!` | Standard full-time |

---

## 📱 Application Access

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001/api
- **Database Admin** (Docker): http://localhost:8080

---

## 🔧 Development

### Root Project Scripts
```bash
# Install all dependencies
npm run install:all

# Start both frontend and backend in development mode
npm run dev

# Build both applications
npm run build

# Run tests for both applications
npm run test

# Demo data management
npm run demo:install    # Add realistic demo data
npm run demo:remove     # Remove demo data
npm run demo:report     # Show demo data summary

# Docker operations
npm run docker:up       # Start all services
npm run docker:down     # Stop all services
npm run docker:logs     # View logs
```

### Backend Development
```bash
cd backend
npm run dev             # Development server with hot reload
npm run build           # Build TypeScript
npm run start           # Start production server
npm run test            # Run tests
npm run lint            # Code linting
```

### Frontend Development
```bash
cd frontend
npm start               # Development server
npm run build           # Production build
npm run test            # Run tests
```

---

## 🔌 API Documentation

### Base URL
- **Development**: `http://localhost:3001/api`
- **Production**: `https://your-domain.com/api`

### Authentication
All protected endpoints require a Bearer token:
```
Authorization: Bearer <jwt_token>
```

### Core Endpoints

#### 🔐 Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify token
- `POST /api/auth/refresh` - Refresh token
- `POST /api/auth/logout` - User logout

#### 👥 User Management
- `GET /api/users` - List users (admin only)
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create user (admin only)
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (admin only)

#### 👷 Employee Management
- `GET /api/employees` - List employees
- `GET /api/employees/:id` - Get employee details
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee

#### 📅 Shift Management
- `GET /api/shifts` - List shifts
- `POST /api/shifts` - Create shift
- `PUT /api/shifts/:id` - Update shift
- `DELETE /api/shifts/:id` - Delete shift
- `POST /api/shifts/:id/assign` - Assign employee to shift
- `DELETE /api/shifts/:id/assign/:employeeId` - Remove assignment

#### 📊 Schedule Management
- `GET /api/schedules` - Get schedules for period
- `POST /api/schedules/generate` - Generate optimal schedule
- `POST /api/schedules/:id/publish` - Publish schedule
- `POST /api/schedules/:id/notify` - Send notifications

#### 🏥 System Health
- `GET /api/health` - Service health check
- `GET /api/ready` - Readiness check

### Example API Usage

#### Login Request
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "Admin123!"}'
```

#### Create Shift
```bash
curl -X POST http://localhost:3001/api/shifts \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Morning Shift",
    "startTime": "08:00",
    "endTime": "16:00",
    "date": "2024-01-20",
    "department": "Sales",
    "minimumStaff": 2,
    "maximumStaff": 4
  }'
```

---

## 🐳 Docker Configuration

### Services
- **MySQL 8.0**: Database with persistent storage
- **Backend**: Node.js API server
- **Frontend**: React development server
- **phpMyAdmin**: Database management interface

### Docker Commands
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Restart specific service
docker-compose restart backend

# Stop all services
docker-compose down

# Rebuild and start
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Production mode (with nginx, redis)
docker-compose --profile production up -d
```

### Environment Variables
Copy `.env.example` to `.env` and configure:
```bash
# Database
MYSQL_DATABASE=staff_scheduler
MYSQL_USER=staffscheduler
MYSQL_PASSWORD=your_secure_password

# Security (CHANGE IN PRODUCTION!)
JWT_SECRET=your-super-secret-jwt-key-very-long-and-random
SESSION_SECRET=your-super-secret-session-key-very-long-and-random

# Application
NODE_ENV=development
PORT=5000
REACT_APP_API_URL=http://localhost:3001/api
```

---

## 📂 Project Structure

```
StaffScheduler/
├── backend/                 # Node.js + Express API
│   ├── src/
│   │   ├── config/         # Configuration files
│   │   ├── middleware/     # Auth, validation, rate limiting
│   │   ├── routes/         # API endpoints
│   │   │   ├── auth.ts     # Authentication routes
│   │   │   ├── users.ts    # User management  
│   │   │   ├── employees.ts # Employee management
│   │   │   ├── shifts.ts   # Shift management
│   │   │   ├── schedules.ts # Schedule generation
│   │   │   └── health.ts   # Health checks
│   │   ├── services/       # Business logic
│   │   │   └── UserService.ts # User operations
│   │   ├── types/          # TypeScript interfaces
│   │   └── utils/          # Helper functions
│   ├── scripts/
│   │   └── demo-data.ts    # Demo data generator
│   ├── package.json        # Backend dependencies
│   └── Dockerfile          # Backend container config
├── frontend/               # React + TypeScript
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/       # API services
│   │   ├── types/          # TypeScript interfaces
│   │   └── utils/          # Helper functions
│   ├── package.json        # Frontend dependencies
│   └── Dockerfile          # Frontend container config
├── docs/                   # Technical documentation
│   └── TECHNICAL.md        # Detailed technical specs
├── docker-compose.yml      # Multi-service orchestration
├── package.json           # Root orchestration scripts
├── .env.example           # Environment template
├── .gitignore             # Git ignore rules
└── README.md              # This guide
```

---

## 🔐 Security & Production

### For Production Deployment:

1. **Change all default passwords and secrets**
2. **Use HTTPS with proper SSL certificates** 
3. **Configure proper CORS origins**
4. **Set up backup procedures**
5. **Enable monitoring and logging**
6. **Use environment-specific configurations**

### Security Features:
- JWT-based authentication with configurable expiry
- Role-based access control (admin/manager/employee)
- Rate limiting on all endpoints
- Request validation and sanitization
- Secure password hashing with bcrypt
- CORS protection
- Helmet security headers

---

## 📊 Features Showcase

The demo data demonstrates:

- **Hierarchical Management**: 4-level organization structure
- **Various Work Patterns**: Full-time, part-time, student schedules  
- **Skill-based Scheduling**: Different roles and capabilities
- **Department Management**: Sales and Logistics departments
- **Shift Templates**: Morning, afternoon, evening, and weekend shifts
- **Employee Profiles**: Diverse availability and preferences
- **Constraint Handling**: Legal requirements, preferences, fairness

---

## 📞 Support & Documentation

- **Technical Details**: See [TECHNICAL.md](./TECHNICAL.md) for mathematical models, algorithms, and implementation details
- **API Documentation**: Available at `/api/docs` when running locally
- **Demo Data**: Use `npm run demo:report` to see current demo state
- **Logs**: Check `backend/logs/` directory or `docker-compose logs`
- **Issues**: Report issues on the project repository

---

## 🚀 Next Steps

1. **Install and explore demo data** to understand the system
2. **Review the API documentation** for integration
3. **Check technical documentation** for optimization algorithms
4. **Configure production environment** with proper security
5. **Customize for your organization** requirements

---

*StaffScheduler - Advanced Workforce Management System*
*Built with Node.js, React, TypeScript, and MySQL*
