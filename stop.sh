#!/bin/bash

##############################################################################
# Staff Scheduler - Shutdown Script
#
# This script gracefully stops and removes all Staff Scheduler containers
# and optionally cleans up volumes and networks.
#
# Usage:
#   ./stop.sh            # Stop containers (keep everything)
#   ./stop.sh -c         # Clean: remove containers and networks (keep volumes)
#   ./stop.sh -p         # Purge: also delete every volume — the database
#                        # included — after you type DELETE
#
# WHY ONLY -p TOUCHES VOLUMES, AND ONLY AFTER A TYPED CONFIRMATION (#847).
# -c used to run `down -v` while the help text said it removed containers, so
# a routine clean-up deleted the production database. Volume deletion is the
# one irreversible action here; it now needs its own flag and a typed word
# that cannot be given by accident or by a stray `yes |`. A --force flag for
# scripts was rejected: automation that means to destroy a database can run
# `docker compose down -v` itself, visibly. Backups are a host directory
# (BACKUP_HOST_DIR, default ./backups), not a volume, so -p leaves them.
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
        print_warning "PURGE mode: this deletes every volume, including the database."
        print_warning "Backups in ${BACKUP_HOST_DIR:-./backups} are kept."
        printf 'Type DELETE to continue: '
        local answer=""
        read -r answer || true
        if [ "$answer" != "DELETE" ]; then
            echo ""
            print_error "Not confirmed; nothing was removed."
            exit 1
        fi
        echo ""
        docker-compose -f "$DOCKER_COMPOSE_FILE" down -v
        print_success "All containers, volumes, and networks have been removed"

    elif [ "$CLEAN_MODE" = true ]; then
        print_warning "CLEAN mode: Removing containers and networks (volumes are kept)..."
        echo ""
        docker-compose -f "$DOCKER_COMPOSE_FILE" down
        print_success "Containers and networks have been removed; volumes are intact"

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
