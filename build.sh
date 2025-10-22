#!/bin/bash

##############################################################################
# Staff Scheduler - Build Script
#
# This script builds Docker images for the Staff Scheduler application.
# Supports building individual services or the complete stack.
#
# Usage:
#   ./build.sh                    # Build all services
#   ./build.sh backend            # Build only backend
#   ./build.sh frontend           # Build only frontend
#   ./build.sh --no-cache        # Build without cache
#   ./build.sh backend --dev      # Build backend for development
#
# Features:
#   - Multi-stage Docker builds
#   - Development and production targets
#   - Optional cache control
#   - Build optimization
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
DOCKER_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# Functions
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

print_section() {
    echo ""
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}$1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    if ! command_exists docker; then
        print_error "Docker is not installed"
        exit 1
    fi
    if ! command_exists docker-compose; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    print_success "Docker and Docker Compose are available"
}

# Parse arguments
SERVICE="all"
NO_CACHE=""
DEV_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        backend|frontend|mysql)
            SERVICE="$1"
            shift
            ;;
        --no-cache)
            NO_CACHE="--no-cache"
            shift
            ;;
        --dev)
            DEV_MODE=true
            shift
            ;;
        *)
            print_error "Unknown argument: $1"
            echo "Usage: ./build.sh [backend|frontend|mysql|all] [--no-cache] [--dev]"
            exit 1
            ;;
    esac
done

# Build services
build_all() {
    print_section "Building All Services"
    DOCKER_BUILDKIT=1 docker-compose -f "$DOCKER_COMPOSE_FILE" build $NO_CACHE
    print_success "All services built successfully"
}

build_backend() {
    print_section "Building Backend Service"
    
    if [ "$DEV_MODE" = true ]; then
        print_info "Building for development (with dev dependencies)..."
        docker build $NO_CACHE \
            -f "${SCRIPT_DIR}/backend/Dockerfile" \
            -t staff-scheduler-backend:dev \
            --target build \
            "${SCRIPT_DIR}/backend"
        print_success "Backend development image built: staff-scheduler-backend:dev"
    else
        print_info "Building for production..."
        docker build $NO_CACHE \
            -f "${SCRIPT_DIR}/backend/Dockerfile" \
            -t staff-scheduler-backend:latest \
            --target production \
            "${SCRIPT_DIR}/backend"
        print_success "Backend production image built: staff-scheduler-backend:latest"
    fi
}

build_frontend() {
    print_section "Building Frontend Service"
    
    if [ "$DEV_MODE" = true ]; then
        print_info "Building for development..."
        docker build $NO_CACHE \
            -f "${SCRIPT_DIR}/frontend/Dockerfile" \
            -t staff-scheduler-frontend:dev \
            --target development \
            "${SCRIPT_DIR}/frontend"
        print_success "Frontend development image built: staff-scheduler-frontend:dev"
    else
        print_info "Building for production..."
        docker build $NO_CACHE \
            -f "${SCRIPT_DIR}/frontend/Dockerfile" \
            -t staff-scheduler-frontend:latest \
            --target production \
            "${SCRIPT_DIR}/frontend"
        print_success "Frontend production image built: staff-scheduler-frontend:latest"
    fi
}

build_mysql() {
    print_section "Building MySQL Service"
    print_info "MySQL uses official image (mysql:8.0) - skipping custom build"
}

# Display built images
show_images() {
    echo ""
    print_info "Built Docker images:"
    docker images | grep -E "staff-scheduler|REPOSITORY" || true
}

# Main execution
main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          Staff Scheduler - Build Script                      ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    check_prerequisites
    echo ""
    
    if [ -n "$NO_CACHE" ]; then
        print_warning "Building without cache (longer build time)"
    fi
    
    if [ "$DEV_MODE" = true ]; then
        print_warning "Development mode enabled"
    fi
    
    case "$SERVICE" in
        all)
            build_all
            ;;
        backend)
            build_backend
            ;;
        frontend)
            build_frontend
            ;;
        mysql)
            build_mysql
            ;;
        *)
            print_error "Unknown service: $SERVICE"
            exit 1
            ;;
    esac
    
    show_images
    echo ""
    print_success "Build completed"
}

# Run main
main "$@"
