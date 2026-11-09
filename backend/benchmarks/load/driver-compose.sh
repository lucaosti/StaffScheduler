# Docker Compose driver for run.sh (sourced, not executed).
#
# The interface every driver implements, called by run.sh:
#   driver_describe              print key=value lines about the runtime
#   stack_up <replicas>          fresh database, migrations + demo seed, Redis,
#                                N backend replicas behind the load balancer
#   stack_down                   remove everything, data included
#   run_k6 <script> [K=V...]     run a k6 script; /results is RESULTS_DIR
#   run_checker <file> [args]    run check/<file> with ts-node in backend/
#   inject <target> down|up      fault injection: db | redis | replica
#   record_components <label>    append restart counters to containers.csv
#   collect_logs                 write backend.log into the run directory
#
# WHY THE PROJECT NAME IS FIXED. `staffscheduler-verify-load` makes this
# stack's MySQL a `staffscheduler-verify*-db-1` container, the name the shared
# memory-budget check counts, and keeps it apart from both the deployment and
# every other verification stack; `down -v` here can only reach its own
# volumes.
#
# Author: Luca Ostinelli

PROJECT=staffscheduler-verify-load
export LOAD_RESULTS_DIR="$RESULTS_DIR"

dc() { docker compose -f "$HERE/compose.yml" -p "$PROJECT" "$@"; }

# The Docker VM holds at most two MySQL-backed stacks; a third is OOM-killed
# and fails for reasons unrelated to what it measures. Wait for a free slot.
wait_for_slot() {
  until [ "$(docker ps --format '{{.Names}}' | grep -cE '^staffscheduler-verify.*-db-1$' || true)" -lt 2 ]; do
    echo "waiting for a free Docker memory slot..."
    sleep 30
  done
}

driver_describe() {
  echo "docker_cpus=$(docker info --format '{{.NCPU}}')"
  echo "docker_mem_bytes=$(docker info --format '{{.MemTotal}}')"
}

stack_up() {
  # Down first: a previous run of this stack would otherwise hold one of the
  # two slots the wait below is counting.
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  wait_for_slot
  # Images are built once and reused, so consecutive runs measure the same
  # build; BUILD=1 rebuilds them.
  if [ "${BUILD:-0}" = 1 ]; then dc build seed backend; fi
  log "stack up ($1 backend replica(s))"
  dc up -d --wait --scale backend="$1" lb backend
}

stack_down() { dc down -v --remove-orphans; }

run_k6() {
  local script="$1" envs=() kv
  shift
  for kv in "$@"; do envs+=(-e "$kv"); done
  dc run --rm --no-deps "${envs[@]}" \
    k6 run --quiet --log-format=raw --console-output="/results/$RUN_NAME/records.jsonl" "$script"
}

run_checker() { dc run --rm --no-deps -e LOG_LEVEL=error checker npx ts-node "benchmarks/load/check/$1" "${@:2}"; }

health_of() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing; }

wait_healthy() {
  local waited=0
  while [ "$(health_of "$1")" != healthy ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 180 ]; then
      echo "$1 did not become healthy within 180 s" >&2
      return 1
    fi
  done
}

inject() {
  local name
  case "$1" in
    db | redis) name="$PROJECT-$1-1" ;;
    # The last replica: the load balancer keeps routing to the others, which
    # is the property a replica outage is meant to test.
    replica) name="$PROJECT-backend-$REPLICAS" ;;
  esac
  case "$CHAOS_MODE:$2" in
    stop:down) docker stop "$name" >/dev/null ;;
    kill:down) docker kill "$name" >/dev/null ;;
    pause:down) docker pause "$name" >/dev/null ;;
    pause:up) docker unpause "$name" >/dev/null ;;
    *:up) docker start "$name" >/dev/null ;;
  esac
  if [ "$2" = up ]; then wait_healthy "$name" || true; fi
}

# A backend process that exits on its own is restarted by the
# `unless-stopped` policy and RestartCount goes up — the crash signal for
# #825. A container stopped on purpose is not counted (docker start does not
# increment it).
record_components() {
  local id
  for id in $(dc ps -a -q backend db redis lb); do
    docker inspect -f "$1,{{.Name}},{{.RestartCount}},{{.State.Status}},{{.State.StartedAt}},{{.State.ExitCode}},{{.State.OOMKilled}}" "$id" |
      sed 's#,/#,#' >>"$RUN_DIR/containers.csv"
  done
}

collect_logs() { dc logs --no-color --timestamps backend >"$RUN_DIR/backend.log" 2>&1 || true; }
