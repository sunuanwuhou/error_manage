#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

mkdir -p .githooks
chmod +x .githooks/pre-push

git config core.hooksPath .githooks

echo "[setup-githooks] core.hooksPath=.githooks"
echo "[setup-githooks] pre-push hook ready"
