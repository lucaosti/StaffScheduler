#!/bin/bash

##############################################################################
# Staff Scheduler - Development Startup Script
#
# This script starts the Staff Scheduler application stack in development
# mode with hot-reload capabilities and debugging features.
#
# Usage:
#   ./start-dev.sh              # Start development environment
#   ./start-dev.sh -b          # Rebuild images before starting
#   ./start-dev.sh --no-cache  # Build without Docker cache
#
# Features:
#   - Hot-reload for backend (nodemon)
#   - Hot-reload for frontend (React dev server)
#   - Debug mode enabled
#   - Source code volumes mounted
#   - Services accessible via localhost
#   - Easy logs viewing
#
# Environment:
#   - NODE_ENV=development
#   - Uses .env.development file if exists, otherwise .env
#
# Author: Luca Ostinelli
# License: MIT
##############################################################################

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.development"
DOCKER_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# Fallback to .env if .env.development doesn't exist
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE="${SCRIPT_DIR}/.env"
fi

##############################################################################
# Helper Functions
##############################################################################

print_info() {
    echo -e "${BLUE}ℹ  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠  $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_debug() {
    echo -e "${MAGENTA}🔍 $1${NC}"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate prerequisites
validate_prerequisites() {
    print_info "Validating prerequisites for development environment..."
    
    if ! command_exists docker; then
        print_error "Docker is not installed."
        exit 1
    fi
    print_success "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
    
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed."
        exit 1
    fi
    print_success "Docker Compose is installed"
}

# Check Docker daemon
check_docker_daemon() {
    print_info "Checking Docker daemon..."
    if ! docker ps > /dev/null 2>&1; then
        print_error "Docker daemon is not running."
        exit 1
    fi
    print_success "Docker daemon is running"
}

# Validate environment
validate_environment() {
    if [ ! -f "$ENV_FILE" ]; then
        print_warning "Environment file not found at $ENV_FILE"
        
        if [ -f "${SCRIPT_DIR}/.env.example" ]; then
            print_info "Creating from .env.example..."
            cp "${SCRIPT_DIR}/.env.example" "$ENV_FILE"
            print_success "Created $ENV_FILE"
        else
            print_error "Cannot find .env.example"
            exit 1
        fi
    fi
}

# Create development environment file for Docker Compose
create_dev_env_override() {
    print_info "Setting up development environment overrides..."
    
    # Create docker-compose.override.yml for development
    cat > "${SCRIPT_DIR}/docker-compose.override.yml" << 'EOF'
# Development environment overrides
version: '3.9'

services:
  backend:
    environment:
      NODE_ENV: development
      DEBUG: "*"
    volumes:
      - ./backend/src:/app/src
      - ./backend/dist:/app/dist
      - /app/node_modules
    command: npm run dev
    ports:
      - "9229:9229"  # Debug port for Node.js inspector

  frontend:
    environment:
      REACT_APP_DEBUG: "true"
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/public:/app/public
      - /app/node_modules
    command: npm start
    stdin_open: true
    tty: true

  mysql:
    environment:
      MYSQL_LOG_BIN: "mysql-bin"
      MYSQL_BINLOG_FORMAT: "row"
    ports:
      - "3306:3306"
    cap_add:
      - SYS_NICE
EOF
    
    print_success "Development overrides created"
}

# Create necessary directories
create_directories() {
    print_info "Creating necessary directories..."
    mkdir -p "${SCRIPT_DIR}/logs"
    mkdir -p "${SCRIPT_DIR}/data"
    print_success "Directories created"
}

# Build development images if needed
build_images() {
    print_info "Building development Docker images..."
    
    DOCKER_BUILDKIT=1 docker-compose -f "$DOCKER_COMPOSE_FILE" build
    
    print_success "Development images built"
}

# Start services
start_services() {
    print_info "Starting development services..."
    print_debug "Using environment file: $ENV_FILE"
    
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    
    print_success "Development services started"
}

# Wait for services
wait_for_services() {
    print_info "Waiting for services to be ready..."
    
    # MySQL
    print_debug "Checking MySQL..."
    for i in {1..20}; do
        if docker-compose exec -T mysql mysqladmin ping -h localhost >/dev/null 2>&1; then
            print_success "MySQL is ready"
            break
        fi
        if [ $i -eq 20 ]; then
            print_warning "MySQL took longer than expected"
        fi
        sleep 1
    done
    
    # Backend
    print_debug "Checking Backend API..."
    sleep 3
    print_success "Backend should be starting (check logs if issues)"
    
    # Frontend
    print_debug "Checking Frontend..."
    sleep 3
    print_success "Frontend should be starting (check logs if issues)"
}

# Display development info
display_dev_info() {
    echo ""
    print_success "=== Staff Scheduler Development Environment Ready ==="
    echo ""
    print_info "Access the application at:"
    echo ""
    echo "  🌐 Frontend:              ${BLUE}http://localhost:3000${NC}"
    echo "  📡 Backend API:           ${BLUE}http://localhost:3001/api${NC}"
    echo "  🔍 Health Check:          ${BLUE}http://localhost:3001/api/health${NC}"
    echo "  💾 Database (phpMyAdmin): ${BLUE}http://localhost:8080${NC}"
    echo "  🐛 Node Debugger:         ${BLUE}127.0.0.1:9229${NC}"
    echo ""
    print_info "Features:"
    echo "  • Backend hot-reload enabled (nodemon)"
    echo "  • Frontend hot-reload enabled (React)"
    echo "  • Source code volumes mounted"
    echo "  • Debug mode enabled"
    echo ""
    print_info "Useful commands:"
    echo ""
    echo "  View logs:"
    echo "    ${BLUE}docker-compose logs -f backend${NC}"
    echo "    ${BLUE}docker-compose logs -f frontend${NC}"
    echo "    ${BLUE}docker-compose logs -f mysql${NC}"
    echo ""
    echo "  Rebuild services:"
    echo "    ${BLUE}docker-compose build --no-cache${NC}"
    echo ""
    echo "  Stop all services:"
    echo "    ${BLUE}./stop.sh${NC}"
    echo ""
    echo "  Run tests (in backend container):"
    echo "    ${BLUE}docker-compose exec backend npm test${NC}"
    echo ""
    echo "  Database management:"
    echo "    ${BLUE}docker-compose exec mysql mysql -u root -p${NC}"
    echo ""
}

# Show running containers
show_containers() {
    echo ""
    print_info "Running containers:"
    docker-compose ps
    echo ""
}

##############################################################################
# Main Execution
##############################################################################

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║       Staff Scheduler - Development Startup Script            ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    validate_prerequisites
    echo ""
    
    check_docker_daemon
    echo ""
    
    validate_environment
    echo ""
    
    create_directories
    echo ""
    
    create_dev_env_override
    echo ""
    
    # Parse arguments
    if [[ "$*" == *"-b"* ]] || [[ "$*" == *"--build"* ]]; then
        build_images
        echo ""
    fi
    
    start_services
    echo ""
    
    wait_for_services
    echo ""
    
    show_containers
    display_dev_info
    
    print_info "To view live logs, open a new terminal and run:"
    echo "  ${BLUE}docker-compose logs -f${NC}"
}

# Trap Ctrl+C to gracefully shutdown
trap_exit() {
    echo ""
    print_warning "Stopping development environment..."
    docker-compose down
    print_success "Development environment stopped"
    exit 0
}

trap trap_exit INT TERM

# Run main
main "$@"

# Keep script running to trap Ctrl+C
while true; do
    sleep 1
done
