#!/bin/bash

##############################################################################
# Staff Scheduler - Shutdown Script
#
# This script gracefully stops and removes all Staff Scheduler containers
# and optionally cleans up volumes and networks.
#
# Usage:
#   ./stop.sh            # Stop containers (keep volumes)
#   ./stop.sh -c         # Clean: remove containers and volumes
#   ./stop.sh -p         # Purge: remove everything including networks
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

# Parse arguments
CLEAN_MODE=false
PURGE_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--clean)
            CLEAN_MODE=true
            shift
            ;;
        -p|--purge)
            PURGE_MODE=true
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Usage: ./stop.sh [-c|--clean] [-p|--purge]"
            exit 1
            ;;
    esac
done

# Main execution
main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║         Staff Scheduler - Shutdown Script                    ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    if [ "$PURGE_MODE" = true ]; then
        print_warning "PURGE mode: Removing all containers, volumes, and networks..."
        echo ""
        docker-compose -f "$DOCKER_COMPOSE_FILE" down -v
        print_success "All containers, volumes, and networks have been removed"
        
    elif [ "$CLEAN_MODE" = true ]; then
        print_warning "CLEAN mode: Removing containers and volumes..."
        echo ""
        docker-compose -f "$DOCKER_COMPOSE_FILE" down -v
        print_success "Containers and volumes have been removed"
        
    else
        print_info "Stopping Staff Scheduler services..."
        echo ""
        docker-compose -f "$DOCKER_COMPOSE_FILE" stop
        print_success "All services have been stopped"
        echo ""
        print_info "Containers are paused. To restart, run ./start.sh"
        echo "To remove containers completely, run: ./stop.sh -c"
        echo "To remove everything including volumes, run: ./stop.sh -p"
    fi
    
    echo ""
    print_info "Docker resources:"
    docker-compose -f "$DOCKER_COMPOSE_FILE" ps
    echo ""
}

main "$@"
