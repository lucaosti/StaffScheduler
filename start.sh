#!/bin/bash

##############################################################################
# Staff Scheduler - Production Startup Script
# 
# This script starts the complete Staff Scheduler application stack in
# production mode using Docker Compose.
#
# Usage:
#   ./start.sh              # Start with default .env settings
#   ./start.sh -e prod.env  # Start with custom environment file
#
# Environment:
#   Uses .env file in the current directory for configuration
#   See .env.example for all available options
#
# Features:
#   - Validates Docker and Docker Compose installation
#   - Checks environment file exists
#   - Builds images if needed
#   - Starts all services with proper health checks
#   - Shows access endpoints after startup
#
# Author: Luca Ostinelli
# License: MIT
##############################################################################

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
DOCKER_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
LOG_FILE="${SCRIPT_DIR}/logs/startup.log"

##############################################################################
# Helper Functions
##############################################################################

# Print colored output
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

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate prerequisites
validate_prerequisites() {
    print_info "Validating prerequisites..."
    
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker found: $(docker --version)"
    
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    print_success "Docker Compose found: $(docker-compose --version)"
}

# Validate environment file
validate_environment() {
    if [ ! -f "$ENV_FILE" ]; then
        print_warning "Environment file not found at $ENV_FILE"
        print_info "Creating from .env.example..."
        
        if [ -f "${SCRIPT_DIR}/.env.example" ]; then
            cp "${SCRIPT_DIR}/.env.example" "$ENV_FILE"
            print_success "Environment file created. Please review and update if needed."
        else
            print_error "No .env.example found to copy from."
            exit 1
        fi
    else
        print_success "Environment file found at $ENV_FILE"
    fi
}

# Create necessary directories
create_directories() {
    print_info "Creating necessary directories..."
    mkdir -p "${SCRIPT_DIR}/logs"
    mkdir -p "${SCRIPT_DIR}/data"
    print_success "Directories created"
}

# Check Docker daemon
check_docker_daemon() {
    print_info "Checking Docker daemon..."
    if ! docker ps > /dev/null 2>&1; then
        print_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
    print_success "Docker daemon is running"
}

# Build images
build_images() {
    print_info "Building Docker images..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" build --no-cache
    print_success "Docker images built successfully"
}

# Start services
start_services() {
    print_info "Starting services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    print_success "Services started"
}

# Wait for services to be ready
wait_for_services() {
    print_info "Waiting for services to be ready..."
    
    # Wait for database
    print_info "  Waiting for MySQL database..."
    for i in {1..30}; do
        if docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T mysql mysqladmin ping -h localhost >/dev/null 2>&1; then
            print_success "  MySQL database is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "MySQL database failed to start"
            exit 1
        fi
        sleep 1
    done
    
    # Wait for backend API
    print_info "  Waiting for Backend API..."
    for i in {1..30}; do
        if docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T backend wget -q -O- http://localhost:3001/api/health >/dev/null 2>&1; then
            print_success "  Backend API is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "Backend API failed to start"
            exit 1
        fi
        sleep 1
    done
    
    # Wait for frontend
    print_info "  Waiting for Frontend..."
    sleep 5  # Give frontend a bit more time to start
    print_success "  Frontend should be starting"
}

# Display access information
display_access_info() {
    echo ""
    print_success "=== Staff Scheduler is Running ==="
    echo ""
    print_info "Access the application at the following URLs:"
    echo ""
    echo "  🌐 Frontend Application:  ${BLUE}http://localhost:3000${NC}"
    echo "  📡 Backend API:            ${BLUE}http://localhost:3001/api${NC}"
    echo "  🔍 API Health Check:       ${BLUE}http://localhost:3001/api/health${NC}"
    echo "  💾 Database Management:    ${BLUE}http://localhost:8080${NC} (phpMyAdmin)"
    echo ""
    print_info "Default login credentials:"
    echo "  Email:    ${BLUE}admin@company.com${NC}"
    echo "  Password: ${BLUE}admin123${NC}"
    echo ""
    print_info "To view logs, run:"
    echo "  ${BLUE}docker-compose logs -f backend${NC}    (Backend logs)"
    echo "  ${BLUE}docker-compose logs -f frontend${NC}   (Frontend logs)"
    echo "  ${BLUE}docker-compose logs -f mysql${NC}      (Database logs)"
    echo ""
    print_info "To stop the application, run:"
    echo "  ${BLUE}./stop.sh${NC}"
    echo ""
}

# Display running containers
show_containers() {
    echo ""
    print_info "Running containers:"
    docker-compose -f "$DOCKER_COMPOSE_FILE" ps
}

##############################################################################
# Main Execution
##############################################################################

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║         Staff Scheduler - Production Startup Script           ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    validate_prerequisites
    echo ""
    
    validate_environment
    echo ""
    
    create_directories
    echo ""
    
    check_docker_daemon
    echo ""
    
    # Parse command line arguments
    if [[ "$*" == *"-b"* ]] || [[ "$*" == *"--build"* ]]; then
        build_images
        echo ""
    fi
    
    start_services
    echo ""
    
    wait_for_services
    echo ""
    
    show_containers
    echo ""
    
    display_access_info
    
    # Log startup
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Staff Scheduler started successfully" >> "$LOG_FILE"
}

# Run main function
main "$@"
