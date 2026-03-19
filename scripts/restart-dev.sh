#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT_DIR/.dev-server.log"
PID_FILE="$ROOT_DIR/.dev-server.pid"
HOST="127.0.0.1"
PORT="3000"

touch "$LOG_FILE"

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill || true
    sleep 1
  fi
}

kill_port 3000
kill_port 3001

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" || true
    sleep 1
  fi
fi

cd "$ROOT_DIR"
# Start Next in the background, then wait for a real listener and HTTP response.
if command -v setsid >/dev/null 2>&1; then
  setsid ./node_modules/.bin/next dev --hostname "$HOST" --port "$PORT" </dev/null >> "$LOG_FILE" 2>&1 &
else
  nohup /bin/zsh -lc "cd '$ROOT_DIR' && exec ./node_modules/.bin/next dev --hostname '$HOST' --port '$PORT'" </dev/null >> "$LOG_FILE" 2>&1 &
fi

server_pid=""
for _ in {1..30}; do
  server_pid="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "$server_pid" ]] && curl --silent --head --max-time 2 "http://$HOST:$PORT/login" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ -z "$server_pid" ]]; then
  echo "dev server failed to become reachable"
  echo "last log lines:"
  tail -n 80 "$LOG_FILE" || true
  exit 1
fi

echo "$server_pid" > "$PID_FILE"

echo "dev server restarting..."
echo "pid: $server_pid"
echo "log: $LOG_FILE"
