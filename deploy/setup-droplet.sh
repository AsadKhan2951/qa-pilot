#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu droplet (24.04). Run as root from the repo folder:
#   bash deploy/setup-droplet.sh
set -euo pipefail

if ! command -v docker >/dev/null; then
  echo "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

# Swap helps Chromium on small droplets
if ! swapon --show | grep -q swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80 >/dev/null 2>&1 || true
ufw allow 443 >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
  sed -i "s|^MONGO_PASSWORD=.*|MONGO_PASSWORD=$(openssl rand -hex 16)|" .env
  echo
  echo ".env created with fresh secrets. Now set DOMAIN, PUBLIC_APP_URL and ANTHROPIC_API_KEY:"
  echo "  nano .env"
  echo "then run:  docker compose up -d --build"
  exit 0
fi

docker compose up -d --build
docker compose ps
