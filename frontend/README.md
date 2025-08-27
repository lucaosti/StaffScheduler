# Staff Scheduler Frontend

Modern React application for workforce management with Bootstrap UI.

## Features

- **React 18** with TypeScript
- **Bootstrap 5** for responsive UI
- **React Router** for navigation
- **React Query** for data fetching
- **React Hook Form** for form management
- **Recharts** for data visualization
- **React Toastify** for notifications

## Getting Started

### Prerequisites

- Node.js 16 or higher
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build

# Run tests
npm test
```

### Environment Variables

Create a `.env` file in the frontend directory:

```env
REACT_APP_API_URL=http://localhost:3001/api
GENERATE_SOURCEMAP=false
```

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Auth/           # Authentication components
│   └── Layout/         # Layout components (Header, Sidebar)
├── contexts/           # React context providers
├── pages/              # Page components
│   ├── Auth/           # Login/Register pages
│   ├── Dashboard/      # Dashboard page
│   ├── Employees/      # Employee management
│   ├── Schedule/       # Schedule management
│   ├── Shifts/         # Shift management
│   ├── Reports/        # Reports and analytics
│   └── Settings/       # Application settings
├── services/           # API service functions
├── types/              # TypeScript type definitions
├── hooks/              # Custom React hooks
└── utils/              # Utility functions
```

## Features

### Authentication
- JWT-based authentication
- Role-based access control (Admin, Manager, Employee)
- Protected routes

### Employee Management
- N-level hierarchical organization
- Skill-based assignment
- Availability tracking

### Schedule Management
- Visual calendar interface
- Drag-and-drop scheduling
- Conflict detection

### Optimization Engine
- Automated shift assignment
- Constraint satisfaction
- Cost optimization

### Reporting
- Comprehensive analytics
- Export capabilities
- Real-time dashboards

## Available Scripts

- `npm start` - Start development server
- `npm run build` - Create production build
- `npm test` - Run test suite
- `npm run eject` - Eject from Create React App

## Contributing

1. Follow the established code structure
2. Use TypeScript for all new files
3. Follow Bootstrap conventions for styling
4. Write tests for new components
5. Update documentation as needed

## License

This project is licensed under the MIT License.
