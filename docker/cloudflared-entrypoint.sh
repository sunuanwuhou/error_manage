#!/bin/sh
set -eu

RUNTIME_DIR="${RUNTIME_DIR:-/runtime}"
TARGET_URL="${TUNNEL_TARGET_URL:-http://app:3000}"
LOG_FILE="${RUNTIME_DIR}/tunnel.log"
URL_FILE="${RUNTIME_DIR}/tunnel-url.txt"

mkdir -p "${RUNTIME_DIR}"
rm -f "${LOG_FILE}" "${URL_FILE}"

touch "${LOG_FILE}"

cloudflared tunnel --no-autoupdate --url "${TARGET_URL}" 2>&1 | tee -a "${LOG_FILE}" &
child_pid=$!

cleanup() {
  kill "${child_pid}" 2>/dev/null || true
}

trap cleanup INT TERM

while kill -0 "${child_pid}" 2>/dev/null; do
  if [ ! -s "${URL_FILE}" ]; then
    url="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "${LOG_FILE}" | tail -n 1 || true)"
    if [ -n "${url}" ]; then
      printf '%s\n' "${url}" > "${URL_FILE}"
    fi
  fi
  sleep 1
done

wait "${child_pid}"
