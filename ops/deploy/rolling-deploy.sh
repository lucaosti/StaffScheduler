#!/usr/bin/env bash
# Zero-downtime rolling deploy of the backend replicas.
#
# WHY THIS IS POSSIBLE: the API is stateless — the token blacklist, auth-context
# cache, module flags and SSE fan-out all live in Redis — so replicas are
# interchangeable and one can be replaced while the others serve traffic. The
# nginx load balancer (docker-compose.scale.yml) and the frontend's /api proxy
# re-resolve the backend hostname through Docker's DNS every few seconds, so
# they pick up new replicas and drop old ones without a reload.
#
# STRATEGY: Compose has no native per-replica rolling update, so the script
# starts the new replicas beside the old ones and then retires the old ones by
# id:
#   1. build the new image and record the ids of the replicas running now
#   2. scale up with --no-recreate, so the old replicas are left exactly as they
#      are and only the added ones start on the new image
#   3. wait until every NEW replica's own healthcheck reports healthy
#   4. wait out the proxies' DNS TTL, so they are routing to the new replicas
#   5. stop the OLD replicas by id (graceful SIGTERM: they stop accepting, the
#      proxies retry the refused connection on another replica, and requests
#      already in flight complete), then remove them
#   6. wait out the TTL again, so the proxies have forgotten the old addresses
# A poller sends a GET and a POST every second throughout and fails the deploy
# if a single one was dropped, so "zero downtime" is verified, not assumed.
#
# WHY NOT THE FORMER SCALE-UP/SCALE-DOWN DANCE (#848). Without --no-recreate,
# `up --scale 2N` recreates the old replicas on the new image too, so for a
# moment nothing old was left serving; the wait loop then passed as soon as the
# load balancer answered, which the OLD replicas did, so an unhealthy new image
# was never caught; `--scale N` back down removes whichever containers Compose
# picks, an order it does not document; nothing waited for the proxies' DNS
# cache; and a GET-only probe hid the case nginx does not retry — a POST that
# had already been sent to a replica as it went away. Ids recorded before the
# change and acted on explicitly remove all four guesses.
#
# Usage: ops/deploy/rolling-deploy.sh [replicas]   (default 2)
# Run from the repository root. Env:
#   COMPOSE_FILE   compose's own variable; default the base file plus the scale
#                  overlay. COMPOSE_PROJECT_NAME selects the project likewise.
#   API_URL        the API as clients reach it (default: the LB on BACKEND_PORT)
#   DRAIN_SECONDS  wait after each switch; must exceed the longest resolver TTL
#                  in front of the replicas (backend-lb 5s, frontend nginx 10s)
set -euo pipefail

REPLICAS="${1:-2}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.scale.yml}"
API_URL="${API_URL:-http://localhost:${BACKEND_PORT:-3001}/api/v1}"
DRAIN_SECONDS="${DRAIN_SECONDS:-15}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
# Longer than the backend's own 10 s graceful-shutdown timer (src/index.ts), so
# a replica finishes its in-flight requests instead of being SIGKILLed.
STOP_TIMEOUT_SECONDS=15

compose() { docker compose "$@"; }

echo "[deploy] building the backend image"
compose build backend

# Word-split on purpose: ids contain no whitespace, and mapfile is missing from
# the bash 3.2 macOS ships.
# shellcheck disable=SC2207
OLD_IDS=( $(compose ps -q backend) )
echo "[deploy] replicas being replaced: ${#OLD_IDS[@]} (${OLD_IDS[*]:-none})"

# One GET (the health endpoint) and one POST per second. The POST is a refresh
# without a token: it is answered 401 by the replica without touching the
# database, and nginx never re-sends a POST once it reached a replica, so it is
# the request a careless switch actually drops. "Dropped" means no HTTP answer
# or a 5xx (502/503/504 are the proxy's own failures); any other status proves
# a replica answered, including a 429 if the rate limiter is tuned low.
POLL_LOG="$(mktemp)"
probe() { # probe <label> <curl args...>
  local label="$1" code
  shift
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@")" || code=000
  if [ "$code" -ge 200 ] && [ "$code" -lt 500 ]; then echo "ok $label $code"; else echo "FAIL $label $code"; fi
}
(
  while true; do
    probe GET "${API_URL}/health" >> "$POLL_LOG"
    probe POST -X POST -H 'Content-Type: application/json' -d '{}' "${API_URL}/auth/refresh" >> "$POLL_LOG"
    sleep 1
  done
) &
POLLER=$!

NEW_IDS=()
DEPLOYED=false
# On any failure before the switch, remove the new replicas so the old ones
# keep serving exactly as before; always stop the poller.
cleanup() {
  kill "$POLLER" 2>/dev/null || true
  if [ "$DEPLOYED" = false ] && [ ${#NEW_IDS[@]} -gt 0 ]; then
    echo "[deploy] rolling back: removing the new replicas ${NEW_IDS[*]}" >&2
    docker rm -f "${NEW_IDS[@]}" >/dev/null || true
  fi
  rm -f "$POLL_LOG"
}
trap cleanup EXIT

TARGET=$(( ${#OLD_IDS[@]} + REPLICAS ))
echo "[deploy] starting ${REPLICAS} new replica(s) beside the old ones (${TARGET} in total)"
compose up -d --no-deps --no-recreate --scale "backend=${TARGET}" backend

for id in $(compose ps -q backend); do
  case " ${OLD_IDS[*]:-} " in *" $id "*) ;; *) NEW_IDS+=("$id") ;; esac
done
if [ ${#NEW_IDS[@]} -ne "$REPLICAS" ]; then
  echo "[deploy] ERROR: expected ${REPLICAS} new replica(s), found ${#NEW_IDS[@]}" >&2
  exit 1
fi

echo "[deploy] waiting for the new replicas' healthchecks: ${NEW_IDS[*]}"
deadline=$(( SECONDS + HEALTH_TIMEOUT_SECONDS ))
for id in "${NEW_IDS[@]}"; do
  while :; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    case "$status" in
      healthy) break ;;
      unhealthy|exited|dead)
        echo "[deploy] ERROR: new replica ${id} is ${status}; its last log lines:" >&2
        docker logs --tail 50 "$id" >&2 || true
        exit 1 ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "[deploy] ERROR: new replica ${id} still ${status} after ${HEALTH_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    sleep 2
  done
done

echo "[deploy] new replicas healthy; waiting ${DRAIN_SECONDS}s for the proxies to resolve them"
sleep "$DRAIN_SECONDS"

DEPLOYED=true
if [ ${#OLD_IDS[@]} -gt 0 ]; then
  echo "[deploy] stopping the old replicas: ${OLD_IDS[*]}"
  docker stop -t "$STOP_TIMEOUT_SECONDS" "${OLD_IDS[@]}" >/dev/null
  docker rm "${OLD_IDS[@]}" >/dev/null
fi

echo "[deploy] waiting ${DRAIN_SECONDS}s for the proxies to forget the old addresses"
sleep "$DRAIN_SECONDS"

kill "$POLLER" 2>/dev/null || true
wait "$POLLER" 2>/dev/null || true
FAILURES="$(grep -c '^FAIL' "$POLL_LOG" || true)"
TOTAL="$(wc -l < "$POLL_LOG" | tr -d ' ')"
POSTS="$(grep -c ' POST ' "$POLL_LOG" || true)"

echo "[deploy] probes: ${TOTAL} total (${POSTS} POST), ${FAILURES} dropped"
if [ "$FAILURES" -ne 0 ]; then
  grep '^FAIL' "$POLL_LOG" | sort | uniq -c >&2
  echo "[deploy] ERROR: ${FAILURES} request(s) were dropped during the deploy" >&2
  exit 1
fi

echo "[deploy] done — ${REPLICAS} replica(s) on the new image, zero dropped requests"
