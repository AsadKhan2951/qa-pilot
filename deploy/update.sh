#!/usr/bin/env bash
# Pull the latest code and redeploy with zero config changes.
set -euo pipefail
git pull
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
