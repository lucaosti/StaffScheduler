# Singularity/Apptainer instance driver for run.sh (sourced, not executed):
# the same scenarios on a host with no Docker daemon, typically a batch node.
# The interface is the one documented in driver-compose.sh.
#
# Every service is a named instance on the loopback interface:
#   db        mysqld (the MySQL image), data on LOAD_WORK
#   redis     redis-server (the Redis image), RDB on LOAD_WORK
#   backend-N node backend/dist/index.js (the toolchain image), under a
#             restart loop standing in for compose's `restart: unless-stopped`
#   lb        nginx with the proxy directives of ops/nginx/backend-lb.conf
# Stopping an instance is the outage; starting it again is the recovery — the
# same two events the compose driver produces with docker stop/start.
#
# Settings (environment):
#   TOOLCHAIN_SIF MYSQL_SIF REDIS_SIF NGINX_SIF K6_SIF   image files (required);
#       MYSQL/REDIS/NGINX/K6 must be the tags compose.yml names
#   LOAD_SRC        repository root with node_modules installed and
#                   packages/shared + backend built (default: this checkout)
#   LOAD_WORK       scratch directory for data and logs (default: TMPDIR)
#   LOAD_PORT_BASE  first of the loopback ports used (default 31000); give
#                   concurrent runs on one host disjoint ranges of 20
#   SIF_CMD         singularity (default) or apptainer
#
# WHAT DIFFERS FROM COMPOSE, deliberately and only here:
#   - no per-service CPU/memory caps (no cgroup delegation is assumed); the
#     batch allocation is the cap, and run.env records it;
#   - the load balancer lists the replicas as a static upstream instead of
#     resolving the `backend` name through Docker DNS — the proxy directives
#     themselves are read from ops/nginx/backend-lb.conf at start-up, so a
#     change there reaches both drivers;
#   - the toolchain image carries Python and OR-Tools, so `generate` runs the
#     CP-SAT engine here, where the production backend image degrades to the
#     greedy engine (#734); generate.csv records which engine ran.
#
# Author: Luca Ostinelli

SIF_CMD="${SIF_CMD:-singularity}"
SRC="${LOAD_SRC:-$(cd "$HERE/../../.." && pwd)}"
WORK="${LOAD_WORK:-${TMPDIR:-/tmp}/load-$$}"
PORT_BASE="${LOAD_PORT_BASE:-31000}"
DB_PORT=$PORT_BASE
REDIS_PORT=$((PORT_BASE + 1))
LB_PORT=$((PORT_BASE + 2))
PREFIX="load$PORT_BASE"
DB_PASSWORD=load

for sif in TOOLCHAIN_SIF MYSQL_SIF REDIS_SIF NGINX_SIF K6_SIF; do
  [ -n "${!sif:-}" ] && [ -f "${!sif}" ] || { echo "driver-instances: $sif is not set to an image file" >&2; exit 2; }
done

backend_port() { echo $((PORT_BASE + 10 + $1)); }

S() { "$SIF_CMD" "$@"; }

# The toolchain, for one-shot commands in backend/ (migrations, seed, checker).
tc() {
  S exec --cleanenv -B "$SRC" -B "$WORK" -B "$RESULTS_DIR:/results" --pwd "$SRC/backend" \
    --env DB_HOST=127.0.0.1 --env DB_PORT="$DB_PORT" --env DB_USER=root --env DB_PASSWORD="$DB_PASSWORD" \
    --env DB_NAME=staff_scheduler --env NODE_ENV=development --env LOG_FILE="$WORK/tools.log" \
    --env DATABASE_URL="mysql://root:$DB_PASSWORD@127.0.0.1:$DB_PORT/staff_scheduler" \
    "$TOOLCHAIN_SIF" "$@"
}

driver_describe() {
  echo "host_cpus=$(nproc 2>/dev/null || echo unknown)"
  echo "allocated_cpus=${SLURM_CPUS_PER_TASK:-unknown}"
  echo "allocated_mem_mb=${SLURM_MEM_PER_NODE:-${SLURM_MEM_PER_CPU:-unknown}}"
  echo "runtime=$("$SIF_CMD" --version 2>/dev/null | head -1)"
}

# An instance has its own PID namespace (the runtime default for instances),
# so stopping it ends every process inside — the daemon included, not only
# the instance's init.
start_instance() { S instance start -B "$SRC" -B "$WORK" "$1" "$PREFIX-$2" >/dev/null; }
stop_instance() { S instance stop ${2:+--signal "$2"} "$PREFIX-$1" >/dev/null 2>&1 || true; }
in_instance() { local name="$1"; shift; S exec "instance://$PREFIX-$name" "$@"; }

wait_for() {
  local what="$1" waited=0
  shift
  until "$@" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 180 ]; then
      echo "$what not ready within 180 s" >&2
      return 1
    fi
  done
}

MYSQL_OPTS=()
mysql_opts() {
  local m="$WORK/mysql"
  MYSQL_OPTS=(--no-defaults --datadir="$m/data" --socket="$m/sock" --pid-file="$m/pid" --tmpdir="$m/tmp"
    --secure-file-priv="$m/files" --port="$DB_PORT" --bind-address=127.0.0.1 --mysqlx=OFF --skip-log-bin
    --log-error="$m/error.log" --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
    --innodb-buffer-pool-size=1G --max-connections=500 --innodb-use-native-aio=OFF)
}
mysql_ping() { in_instance db mysqladmin --socket="$WORK/mysql/sock" -uroot -p"$DB_PASSWORD" ping; }

start_db() {
  start_instance "$MYSQL_SIF" db
  in_instance db mysqld "${MYSQL_OPTS[@]}" >>"$WORK/mysql/stdout.log" 2>&1 &
  wait_for mysql mysql_ping
}

start_redis() {
  start_instance "$REDIS_SIF" redis
  # Default persistence (RDB on shutdown) into LOAD_WORK, so a stop/start keeps
  # what Redis held — as a stopped and restarted container does.
  in_instance redis redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --dir "$WORK/redis" \
    --maxmemory 256mb --maxmemory-policy allkeys-lru >>"$WORK/redis/stdout.log" 2>&1 &
  wait_for redis in_instance redis redis-cli -p "$REDIS_PORT" ping
}

start_backend() {
  local i="$1" port dir
  port="$(backend_port "$i")"
  dir="$WORK/backend-$i"
  mkdir -p "$dir"
  start_instance "$TOOLCHAIN_SIF" "backend-$i"
  # The loop stands in for `restart: unless-stopped`: a process that exits on
  # its own is started again and the exit is appended to exits.csv — the
  # crash signal for #825. Stopping the instance ends the loop with it.
  S exec --cleanenv --env-file "$WORK/backend.env" --env PORT="$port" --env LOG_FILE="$dir/app.log" \
    "instance://$PREFIX-backend-$i" bash -c \
    "cd '$SRC/backend'; while true; do node dist/index.js; rc=\$?; echo \"\$(date +%s%3N),exit,\$rc\" >>'$dir/exits.csv'; sleep 1; done" \
    >>"$dir/stdout.log" 2>&1 &
  wait_for "backend-$i" in_instance "backend-$i" curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/health"
}

write_lb_conf() {
  local dir="$WORK/nginx" i upstream=""
  mkdir -p "$dir/tmp"
  # max_fails=0: a static upstream would otherwise remember failures and take a
  # replica out of rotation for fail_timeout, answering "no live upstreams"
  # 502s of its own. The production config resolves `backend` per request
  # through a variable, which builds a fresh implicit upstream each time and
  # keeps no such memory; max_fails=0 is the static equivalent.
  for i in $(seq 1 "$REPLICAS"); do upstream="$upstream    server 127.0.0.1:$(backend_port "$i") max_fails=0;"$'\n'; done
  {
    echo "worker_processes 2;"
    echo "pid $dir/nginx.pid;"
    echo "error_log $dir/error.log warn;"
    echo "events { worker_connections 4096; }"
    echo "http {"
    echo "  access_log off;"
    for t in client_body proxy fastcgi uwsgi scgi; do echo "  ${t}_temp_path $dir/tmp/$t;"; done
    echo "  upstream backend_pool {"
    printf '%s' "$upstream"
    echo "  }"
    echo "  server {"
    echo "    listen 127.0.0.1:$LB_PORT;"
    echo "    location / {"
    # The production directives verbatim, minus the Docker-DNS indirection.
    sed -n '/location \/ {/,/^    }/p' "$SRC/ops/nginx/backend-lb.conf" |
      grep -E '^\s*proxy_' | grep -v 'proxy_pass'
    echo "      proxy_pass http://backend_pool;"
    echo "    }"
    echo "  }"
    echo "}"
  } >"$dir/nginx.conf"
}

start_lb() {
  start_instance "$NGINX_SIF" lb
  in_instance lb nginx -p "$WORK/nginx" -c "$WORK/nginx/nginx.conf" -g 'daemon off;' >>"$WORK/nginx/stdout.log" 2>&1 &
  wait_for lb in_instance lb wget -q -O /dev/null "http://127.0.0.1:$LB_PORT/api/v1/health"
}

stack_up() {
  stack_down >/dev/null 2>&1 || true
  REPLICAS="$1"
  mkdir -p "$WORK/mysql/data" "$WORK/mysql/tmp" "$WORK/mysql/files" "$WORK/redis" "$WORK/seed"
  # k6 reads its credentials from these two seed files (k6/lib.js).
  cp "$SRC/backend/scripts/fixtures/demo/data.json" "$SRC/backend/scripts/seed-demo.ts" "$WORK/seed/"
  log "stack up ($REPLICAS backend replica(s)) in $WORK, ports $PORT_BASE+"
  mysql_opts
  S exec -B "$WORK" "$MYSQL_SIF" mysqld "${MYSQL_OPTS[@]}" --initialize-insecure
  start_db
  in_instance db mysql --socket="$WORK/mysql/sock" -uroot -e \
    "ALTER USER root@localhost IDENTIFIED BY '$DB_PASSWORD'; CREATE USER root@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
     GRANT ALL ON *.* TO root@'127.0.0.1' WITH GRANT OPTION; CREATE DATABASE staff_scheduler;"
  start_redis
  tc bash -c "npx dbmate --migrations-dir db/migrations --no-dump-schema up && npx ts-node scripts/seed-demo.ts" >"$WORK/seed.log" 2>&1 ||
    { cat "$WORK/seed.log"; return 1; }
  # Mirrors the backend environment in compose.yml; see the rationale there.
  cat >"$WORK/backend.env" <<EOF
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=$DB_PORT
DB_NAME=staff_scheduler
DB_USER=root
DB_PASSWORD=$DB_PASSWORD
REDIS_URL=redis://127.0.0.1:$REDIS_PORT
JWT_SECRET=load-test-only-secret-not-for-production
JWT_EXPIRES_IN=${LOAD_JWT_EXPIRES_IN:-4h}
DB_POOL_LIMIT=${LOAD_DB_POOL_LIMIT:-30}
DB_QUEUE_LIMIT=${LOAD_DB_QUEUE_LIMIT:-100}
LOG_LEVEL=${LOAD_LOG_LEVEL:-info}
TRUST_PROXY_HOPS=2
RATE_LIMIT_MAX_REQUESTS=${LOAD_RATE_LIMIT_MAX:-1000000}
RATE_LIMIT_ORG_MAX_REQUESTS=${LOAD_RATE_LIMIT_ORG_MAX:-1000000}
EOF
  local i
  for i in $(seq 1 "$REPLICAS"); do start_backend "$i"; done
  write_lb_conf
  start_lb
}

stack_down() {
  local name
  for name in lb $(seq -f 'backend-%g' 1 "${REPLICAS:-8}") redis db; do stop_instance "$name"; done
  if [ "${KEEP_WORK:-0}" != 1 ]; then rm -rf "$WORK"; fi
}

run_k6() {
  local script="$1" envs=() kv
  shift
  for kv in "$@" "BASE_URL=http://127.0.0.1:$LB_PORT/api/v1"; do envs+=(--env "$kv"); done
  S exec --cleanenv -B "$SRC/backend/benchmarks/load/k6:/scripts" -B "$WORK/seed:/seed" -B "$RESULTS_DIR:/results" \
    --pwd /scripts "${envs[@]}" "$K6_SIF" \
    k6 run --quiet --log-format=raw --console-output="/results/$RUN_NAME/records.jsonl" "$script"
}

run_checker() { tc env LOG_LEVEL=error npx ts-node "benchmarks/load/check/$1" "${@:2}"; }

# Host PIDs of every process inside an instance, for SIGSTOP/SIGCONT: the
# instance's init PID comes from `instance list`, its descendants from ps.
instance_pids() {
  local root
  root="$(S instance list "$PREFIX-$1" 2>/dev/null | awk -v n="$PREFIX-$1" '$1 == n { print $2 }')"
  [ -n "$root" ] || return 0
  ps -e -o pid=,ppid= | awk -v root="$root" '
    { parent[$1] = $2 }
    END { for (p in parent) { q = p; while (q in parent && q != root && q != 1) q = parent[q]; if (q == root) print p } print root }'
}

component() {
  case "$1" in
    db | redis) echo "$1" ;;
    # The last replica, as in the compose driver.
    replica) echo "backend-$REPLICAS" ;;
  esac
}

restart_component() {
  case "$1" in
    db) start_db ;;
    redis) start_redis ;;
    backend-*) start_backend "${1#backend-}" ;;
  esac
}

inject() {
  local name
  name="$(component "$1")"
  case "$CHAOS_MODE:$2" in
    stop:down) stop_instance "$name" ;;
    kill:down) stop_instance "$name" KILL ;;
    pause:down) instance_pids "$name" | xargs -r kill -STOP ;;
    pause:up) instance_pids "$name" | xargs -r kill -CONT ;;
    *:up) restart_component "$name" || true ;;
  esac
}

record_components() {
  local i exits
  for i in $(seq 1 "$REPLICAS"); do
    exits=0
    [ -f "$WORK/backend-$i/exits.csv" ] && exits="$(wc -l <"$WORK/backend-$i/exits.csv" | tr -d ' ')"
    echo "$1,backend-$i,$exits,$(instance_pids "backend-$i" | grep -q . && echo running || echo stopped),,," >>"$RUN_DIR/containers.csv"
  done
}

collect_logs() {
  local i
  for i in $(seq 1 "$REPLICAS"); do
    sed "s/^/backend-$i | /" "$WORK/backend-$i/stdout.log" 2>/dev/null
    [ -f "$WORK/backend-$i/exits.csv" ] && sed "s/^/backend-$i | process /" "$WORK/backend-$i/exits.csv"
  done >"$RUN_DIR/backend.log"
  cp "$WORK/mysql/error.log" "$RUN_DIR/mysqld-error.log" 2>/dev/null || true
  cp "$WORK/nginx/error.log" "$RUN_DIR/lb-error.log" 2>/dev/null || true
}
