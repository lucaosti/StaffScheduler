#!/usr/bin/env bash
# Zero-downtime rolling deploy of the backend replicas.
#
# WHY THIS IS POSSIBLE: the API is stateless — the token blacklist, auth-context
# cache, module flags and SSE fan-out all live in Redis — so replicas are
# interchangeable and one can be replaced while the others serve traffic. The
# nginx load balancer (docker-compose.scale.yml) re-resolves the backend
# hostname every few seconds, so it picks up new replicas and drops old ones
# without a reload.
#
# STRATEGY: Compose has no native per-replica rolling update, so we do the
# standard scale-up/scale-down dance:
#   1. build the new image
#   2. scale UP to 2N — the new replicas start on the new image while the old
#      ones keep serving
#   3. wait until the load balancer is healthy and answering
#   4. scale back DOWN to N — Compose removes the oldest containers, i.e. the
#      ones running the previous image
# A poller hits /api/health throughout and fails the deploy if any request is
# dropped, so "zero downtime" is verified rather than assumed.
#
# Usage: ops/deploy/rolling-deploy.sh [replicas]   (default 2)
set -euo pipefail

REPLICAS="${1:-2}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.scale.yml)
HEALTH_URL="${HEALTH_URL:-http://localhost:${BACKEND_PORT:-3001}/api/health}"

echo "[deploy] building the backend image"
"${COMPOSE[@]}" build backend

echo "[deploy] starting a health poller against ${HEALTH_URL}"
POLL_LOG="$(mktemp)"
(
  while true; do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      echo ok >> "$POLL_LOG"
    else
      echo FAIL >> "$POLL_LOG"
    fi
    sleep 0.5
  done
) &
POLLER=$!
# Always stop the poller, even if the deploy fails.
trap 'kill "$POLLER" 2>/dev/null || true' EXIT

echo "[deploy] scaling up to $((REPLICAS * 2)) replicas (new image alongside old)"
"${COMPOSE[@]}" up -d --no-deps --scale "backend=$((REPLICAS * 2))" backend

echo "[deploy] waiting for the load balancer to answer from the new replicas"
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[deploy] healthy after ${i} checks"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[deploy] ERROR: backend did not become healthy" >&2
    exit 1
  fi
  sleep 2
done

echo "[deploy] scaling back down to ${REPLICAS} (removes the oldest containers)"
"${COMPOSE[@]}" up -d --no-deps --scale "backend=${REPLICAS}" backend

# Give the load balancer one resolver TTL to forget the removed replicas.
sleep 6

kill "$POLLER" 2>/dev/null || true
FAILURES="$(grep -c FAIL "$POLL_LOG" || true)"
TOTAL="$(wc -l < "$POLL_LOG" | tr -d ' ')"
rm -f "$POLL_LOG"

echo "[deploy] health probes: ${TOTAL} total, ${FAILURES} failed"
if [ "${FAILURES}" -ne 0 ]; then
  echo "[deploy] ERROR: ${FAILURES} request(s) were dropped during the deploy" >&2
  exit 1
fi

echo "[deploy] done — rolling deploy completed with zero dropped requests"
