#!/usr/bin/env bash
# Deploy the API on the EC2 box. Run FROM the repo folder on the server:
#   ./scripts/deploy.sh [branch]        (default branch: main)
# Pulls the branch, installs prod deps, reloads pm2, then waits for /health to return 200.
set -euo pipefail

BRANCH="${1:-main}"
APP_NAME="fotoshop-api"
HEALTH_TIMEOUT_S=30

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "[deploy] Working tree is dirty - refusing to deploy. Commit/stash/discard first:" >&2
  git status --short >&2
  exit 1
fi

echo "[deploy] Updating to origin/${BRANCH}"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only

echo "[deploy] Installing production dependencies"
npm ci --omit=dev

echo "[deploy] Reloading pm2 process ${APP_NAME}"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  echo "[deploy] ${APP_NAME} not found in pm2 - starting it"
  pm2 start src/index.js --name "$APP_NAME"
fi
pm2 save

# PORT may only be set in .env (never read here); default matches src/index.js.
PORT_TO_CHECK="${PORT:-3000}"
URL="http://127.0.0.1:${PORT_TO_CHECK}/health"
echo "[deploy] Waiting up to ${HEALTH_TIMEOUT_S}s for ${URL}"
deadline=$((SECONDS + HEALTH_TIMEOUT_S))
while true; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL" || true)"
  if [ "$code" = "200" ]; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "[deploy] FAILED: ${URL} did not return 200 within ${HEALTH_TIMEOUT_S}s (last status: ${code:-none})" >&2
    echo "[deploy] Last 50 pm2 log lines:" >&2
    pm2 logs "$APP_NAME" --lines 50 --nostream >&2 || true
    exit 1
  fi
  sleep 2
done

echo "[deploy] OK - ${APP_NAME} healthy. Deployed commit: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD))"
