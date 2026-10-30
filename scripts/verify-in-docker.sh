#!/usr/bin/env bash
# Run the verification gate in containers, with nothing installed on the host.
#
# Usage:
#   ./scripts/verify-in-docker.sh [gate ...]   run gates (default: all); see scripts/verify.sh
#   ./scripts/verify-in-docker.sh serve        seeded app on http://127.0.0.1:3000 (API :3001)
#   ./scripts/verify-in-docker.sh shell        interactive shell in the toolchain container
#   ./scripts/verify-in-docker.sh down         remove the verification stack and its volumes
#
# Requires only Docker. The stack is a separate compose project
# (docker-compose.verify.yml), so `down` never touches the deployment's volumes.
#
# Author: Luca Ostinelli

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose() { docker compose -f "${ROOT_DIR}/docker-compose.verify.yml" "$@"; }

docker info >/dev/null 2>&1 || { echo "Docker is not running" >&2; exit 1; }

case "${1:-all}" in
  down)
    compose down -v --remove-orphans
    ;;
  shell)
    compose build toolchain
    compose run --rm toolchain bash
    ;;
  serve)
    compose build toolchain
    # Install first: the container keeps its own (Linux) node_modules in volumes.
    compose run --rm toolchain scripts/verify.sh install
    compose run --rm --service-ports toolchain scripts/verify.sh serve
    ;;
  *)
    compose build toolchain
    compose run --rm toolchain scripts/verify.sh "$@"
    ;;
esac
