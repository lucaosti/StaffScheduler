# 📅 Staff Scheduler

> **Advanced Workforce Management and Scheduling System**

Staff Scheduler is a comprehensive and modern solution for optimized workforce management. The system provides intelligent tools for shift planning, employee management, and human resource optimization.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-18.2.0-blue.svg)

## 🌟 Key Features

### 🎯 Intelligent Optimization
- **Advanced optimization algorithm** based on Simulated Annealing
- Automatic management of hard and soft constraints
- Automatic workload balancing
- Respect for employee preferences and availability

### 👥 Complete Personnel Management
- Detailed employee profiles with skills and certifications
- Multi-department management
- Tracking of worked hours and overtime
- Leave and time-off request system

### 📊 Dashboard and Reporting
- Interactive dashboard with real-time metrics
- Customizable reports (Excel, PDF, CSV)
- Performance and cost analysis
- Advanced graphical visualizations

### 🔒 Security and Access Control
- JWT authentication with secure sessions
- Role-based access control (RBAC)
- Password encryption with bcrypt
- Rate limiting and CSRF protection

### 🎨 Modern Interface
- Responsive and mobile-friendly design
- Drag-and-drop interface for scheduling
- Customized Bootstrap 5 theme
- Real-time notifications with toast

## 🚀 Quick Start

### Prerequisites

- **Docker** and **Docker Compose** (recommended)
- **Node.js** >= 18.0.0
- **MySQL** >= 8.0
- **npm** or **yarn**

### Installation with Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/lucaosti/StaffScheduler.git
cd StaffScheduler

# Start all services with Docker Compose
./start.sh
```

The application will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **phpMyAdmin**: http://localhost:8080

### Manual Installation

```bash
# Backend
cd backend
npm install
npm run db:init
npm run dev

# Frontend (in a new terminal)
cd frontend
npm install
npm start
```

### Default Credentials

After initialization, you can login with:

- **Admin**: `admin@staffscheduler.com` / `admin123`
- **Manager**: `manager@staffscheduler.com` / `manager123`
- **Employee**: `employee@staffscheduler.com` / `employee123`

## 📁 Project Structure

### Installazione Manuale

```bash
# Backend
cd backend
npm install
npm run db:init
npm run dev

# Frontend (in un nuovo terminale)
cd frontend
npm install
npm start
```

### Credenziali di Default

Dopo l'inizializzazione, puoi accedere con:

- **Admin**: `admin@staffscheduler.com` / `admin123`
- **Manager**: `manager@staffscheduler.com` / `manager123`
- **Dipendente**: `employee@staffscheduler.com` / `employee123`

## 📁 Project Structure

```
StaffScheduler/
├── backend/                 # Node.js/Express REST API
│   ├── src/
│   │   ├── config/         # Configurations
│   │   ├── middleware/     # Express middleware
│   │   ├── routes/         # API endpoints
│   │   ├── services/       # Business logic
│   │   ├── optimization/   # Optimization engine
│   │   └── types/          # TypeScript definitions
│   ├── database/           # SQL schema and migrations
│   └── scripts/            # Utility scripts
│
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── contexts/       # React Context API
│   │   ├── pages/          # Application pages
│   │   ├── services/       # API client
│   │   └── types/          # TypeScript definitions
│   └── public/             # Static assets
│
├── mysql/                  # MySQL configurations
├── docker-compose.yml      # Container orchestration
└── scripts/                # Management scripts
```

## 🛠️ Available Commands

### Main Scripts

```bash
./start.sh              # Start application in production
./start-dev.sh          # Start in development mode
./stop.sh               # Stop all containers
./build.sh              # Build Docker images
./maintenance.sh        # Interactive maintenance menu
```

### Backend

```bash
npm run dev             # Start server in development mode
npm run build           # Build for production
npm test                # Run tests
npm run db:init         # Initialize database
npm run demo:install    # Install demo data
```

### Frontend

```bash
npm start               # Start application in development
npm run build           # Build for production
npm test                # Run tests
npm run lint            # Lint code
```

## 📚 Detailed Features

### Shift Management
- Create and edit shifts with flexible schedules
- Reusable shift templates
- Copy shifts between different periods
- Monthly/weekly/daily calendar view

### Employee Management
- Complete profiles with photos and documents
- Skills and certifications management
- Availability and preferences tracking
- Assignment history and performance

### Schedule Optimization
- Automatic generation of optimal schedules
- Consideration of multiple constraints:
  - Maximum/minimum weekly hours
  - Mandatory rest periods
  - Required skills
  - Employee preferences
  - Department budget

### Reports and Analytics
- Hours worked reports by employee/department
- Personnel cost analysis
- Shift coverage statistics
- Export to Excel, PDF, CSV
- Dashboard with customizable KPIs

## 🔧 Configuration

Environment variables can be configured through the `.env` file:

```env
# Database
MYSQL_ROOT_PASSWORD=your_root_password
MYSQL_DATABASE=staff_scheduler
MYSQL_USER=scheduler_user
MYSQL_PASSWORD=scheduler_password

# Backend
NODE_ENV=production
PORT=3001
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret

# Frontend
REACT_APP_API_URL=http://localhost:3001
REACT_APP_APP_NAME=Staff Scheduler
```

## 🧪 Testing

The project includes comprehensive test suites:

```bash
# Backend
npm run test              # Unit tests
npm run test:integration  # Integration tests
npm run test:coverage     # Code coverage report

# Frontend
npm test                  # React component tests
npm run test:coverage     # Coverage report
```

## 📖 Documentation

For detailed technical information, see:

- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Complete REST API reference
- **[TECHNICAL.md](./TECHNICAL.md)** - Complete technical documentation
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contributing guide

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## 📝 License

This project is distributed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## 👨‍💻 Author

**Luca Ostinelli**

- GitHub: [@lucaosti](https://github.com/lucaosti)

## 🙏 Acknowledgments

- React and the React ecosystem
- Express.js and the Node.js community
- Bootstrap for the UI framework
- All open source contributors

## 📞 Support

For questions, issues, or feature requests:

- Open an [Issue](https://github.com/lucaosti/StaffScheduler/issues)

---

<div align="center">
Made with ❤️ by Luca Ostinelli
</div>
