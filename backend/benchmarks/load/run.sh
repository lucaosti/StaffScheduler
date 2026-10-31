#!/usr/bin/env bash
# Load, race and chaos runs for #958.
#
# Usage:
#   backend/benchmarks/load/run.sh load     # mixed workload, invariants after
#   backend/benchmarks/load/run.sh race     # #829: concurrent POST /assignments
#   backend/benchmarks/load/run.sh chaos    # load + MySQL/Redis/replica outages
#   backend/benchmarks/load/run.sh all      # the three above, each on a fresh stack
#   backend/benchmarks/load/run.sh down     # remove the stack and its data
#
# WHY TWO RUNTIME DRIVERS BEHIND ONE SCENARIO SCRIPT. The scenarios — what is
# measured, when a fault is injected, what is checked afterwards — must be the
# same wherever the harness runs, or results from two machines are not
# comparable. What differs is only how the services are started and stopped:
#   LOAD_DRIVER=compose    (default) Docker Compose, compose.yml — a
#                          workstation or CI runner with a Docker daemon.
#   LOAD_DRIVER=instances  Singularity/Apptainer instances on one host — a
#                          batch node without a Docker daemon, where large runs
#                          go. See driver-instances.sh for its settings.
# Each driver implements the same eight functions (see driver-compose.sh);
# this file owns everything else.
#
# Knobs (environment; defaults are sized for an 8 GB Docker VM):
#   VUS=10 DURATION=3m WARMUP_S=20 THINK_MS=300 MANAGER_SHARE=0.25
#   GENERATE_EVERY_S=30 GENERATE_TIMEOUT_S=120 HEALTH_RPS=2 REQUEST_TIMEOUT=15s
#   REPLICAS            backend replicas behind the load balancer
#                       (default 1 for load/race, 2 for chaos)
#   RACE_ROUNDS=10 RACE_CONCURRENCY=8
#   CHAOS_HOLD_S=45     how long each dependency stays down; longer than the
#                       30 s poll of the outbox-style workers, so every worker
#                       ticks at least once against the dead dependency (#825)
#   CHAOS_RECOVER_S=40  observation time after each dependency is back
#   CHAOS_MODE=stop     stop (SIGTERM) | kill (SIGKILL) | pause (SIGSTOP: the
#                       peer keeps its connections open and never answers)
#   CHAOS_TARGETS="db redis replica"
#   RESULTS_DIR         where run directories go (default ./results here)
#   RUN_LABEL           suffix for the run directory name (array tasks)
#   KEEP_STACK=1        leave the stack up after the run, for inspection
#
# Each run writes <RESULTS_DIR>/<scenario>-<UTC timestamp>[-label]/ with
# run.env, records.jsonl, the CSV tables (see methodology.md),
# invariants.csv/json, containers.csv and backend.log.
#
# Author: Luca Ostinelli

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="${RESULTS_DIR:-$HERE/results}"
mkdir -p "$RESULTS_DIR"
RESULTS_DIR="$(cd "$RESULTS_DIR" && pwd)"

VUS="${VUS:-10}"
DURATION="${DURATION:-3m}"
WARMUP_S="${WARMUP_S:-20}"
THINK_MS="${THINK_MS:-300}"
MANAGER_SHARE="${MANAGER_SHARE:-0.25}"
RACE_ROUNDS="${RACE_ROUNDS:-10}"
RACE_CONCURRENCY="${RACE_CONCURRENCY:-8}"
CHAOS_HOLD_S="${CHAOS_HOLD_S:-45}"
CHAOS_RECOVER_S="${CHAOS_RECOVER_S:-40}"
CHAOS_MODE="${CHAOS_MODE:-stop}"
CHAOS_TARGETS="${CHAOS_TARGETS:-db redis replica}"
LOAD_DRIVER="${LOAD_DRIVER:-compose}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Wall clock in ms. GNU date resolves milliseconds; BSD date (macOS) has no
# %N, so there the quantum is one second — well inside outage windows tens of
# seconds long (methodology.md, "Clocks").
now_ms() {
  local ms
  ms="$(date +%s%3N)"
  case "$ms" in *N) echo "$(date +%s)000" ;; *) echo "$ms" ;; esac
}

event() { echo "$(now_ms),$1,$2" >>"$RUN_DIR/events.csv"; }

# shellcheck source=/dev/null
. "$HERE/driver-$LOAD_DRIVER.sh"

new_run() {
  RUN_NAME="$1-$(date -u +%Y%m%dT%H%M%SZ)${RUN_LABEL:+-$RUN_LABEL}"
  RUN_DIR="$RESULTS_DIR/$RUN_NAME"
  mkdir -p "$RUN_DIR"
  echo "phase,component,restart_count,status,started_at,exit_code,oom_killed" >"$RUN_DIR/containers.csv"
  # The parameters travel with the numbers: a figure without its run
  # configuration cannot be compared with anything.
  {
    echo "scenario=$1"
    echo "driver=$LOAD_DRIVER"
    echo "git_commit=$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo "${GIT_COMMIT:-unknown}")"
    echo "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    driver_describe
    for v in VUS DURATION WARMUP_S THINK_MS MANAGER_SHARE REPLICAS RACE_ROUNDS RACE_CONCURRENCY \
      CHAOS_HOLD_S CHAOS_RECOVER_S CHAOS_MODE CHAOS_TARGETS; do
      echo "$v=${!v:-}"
    done
  } >"$RUN_DIR/run.env"
  log "run $RUN_NAME"
}

k6() {
  run_k6 "$1" \
    VUS="$VUS" DURATION="$DURATION" THINK_MS="$THINK_MS" MANAGER_SHARE="$MANAGER_SHARE" \
    RACE_ROUNDS="$RACE_ROUNDS" RACE_CONCURRENCY="$RACE_CONCURRENCY" \
    GENERATE_EVERY_S="${GENERATE_EVERY_S:-30}" GENERATE_TIMEOUT_S="${GENERATE_TIMEOUT_S:-120}" \
    HEALTH_RPS="${HEALTH_RPS:-2}" REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-15s}" RACE_DAYS_AHEAD="${RACE_DAYS_AHEAD:-400}"
}

baseline() {
  log "baseline invariants"
  run_checker invariants.ts snapshot "/results/$RUN_NAME/baseline.json"
}

finish() {
  local warmup="$1" status=0
  log "invariants"
  run_checker invariants.ts verify "/results/$RUN_NAME/baseline.json" "/results/$RUN_NAME/records.jsonl" "/results/$RUN_NAME" || status=$?
  log "report"
  run_checker report.ts "/results/$RUN_NAME" "$warmup" || echo "report failed"
  record_components end
  collect_logs
  echo "invariants_exit=$status" >>"$RUN_DIR/run.env"
  log "results in $RUN_DIR"
}

end_stack() {
  if [ "${KEEP_STACK:-0}" = 1 ]; then
    echo "KEEP_STACK=1: stack left running (run.sh down removes it)"
  else
    stack_down
  fi
}

scenario_load() {
  REPLICAS="${REPLICAS:-1}"
  stack_up "$REPLICAS"
  new_run load
  baseline
  record_components start
  log "k6 load: $VUS sessions for $DURATION"
  k6 load.js >"$RUN_DIR/k6.log" 2>&1 || echo "k6 exited non-zero (see k6.log)"
  finish "$WARMUP_S"
  end_stack
}

scenario_race() {
  REPLICAS="${REPLICAS:-1}"
  stack_up "$REPLICAS"
  new_run race
  baseline
  record_components start
  log "k6 race: $RACE_ROUNDS rounds x $RACE_CONCURRENCY concurrent requests"
  k6 race.js >"$RUN_DIR/k6.log" 2>&1 || echo "k6 exited non-zero (see k6.log)"
  finish 0
  end_stack
}

scenario_chaos() {
  REPLICAS="${REPLICAS:-2}"
  stack_up "$REPLICAS"
  new_run chaos
  echo "t_ms,phase,action" >"$RUN_DIR/events.csv"
  baseline
  record_components start

  local phases=0 target
  for target in $CHAOS_TARGETS; do phases=$((phases + 1)); done
  # Long enough for every phase plus the time a restarted MySQL needs to
  # report healthy; the timeline is cut by the events, not by this figure.
  DURATION="$((WARMUP_S + phases * (CHAOS_HOLD_S + CHAOS_RECOVER_S + 30) + 30))s"
  log "k6 load under chaos: $VUS sessions for $DURATION, targets: $CHAOS_TARGETS ($CHAOS_MODE)"
  k6 load.js >"$RUN_DIR/k6.log" 2>&1 &
  local k6_pid=$!

  sleep "$WARMUP_S"
  for target in $CHAOS_TARGETS; do
    if [ "$target" = replica ] && [ "$REPLICAS" -lt 2 ]; then
      echo "skipping replica outage: REPLICAS=$REPLICAS"
      continue
    fi
    log "chaos: $target $CHAOS_MODE"
    event "$target" down
    inject "$target" down
    sleep "$CHAOS_HOLD_S"
    event "$target" up
    inject "$target" up
    event "$target" healthy
    record_components "after-$target"
    sleep "$CHAOS_RECOVER_S"
  done
  log "chaos done; waiting for k6 to finish"
  wait "$k6_pid" || echo "k6 exited non-zero (see k6.log)"
  finish "$WARMUP_S"
  end_stack
}

case "${1:-}" in
  load) scenario_load ;;
  race) scenario_race ;;
  chaos) scenario_chaos ;;
  all)
    scenario_load
    unset REPLICAS
    scenario_race
    unset REPLICAS
    scenario_chaos
    ;;
  down) stack_down ;;
  *)
    sed -n '2,40p' "$0"
    exit 2
    ;;
esac
