#!/usr/bin/env bash
# Build the prototype and deploy it as a new atomic release, Mina-style:
#   $REMOTE_PATH/releases/<timestamp>/   <- this deploy's files
#   $REMOTE_PATH/current                 <- symlink, flipped atomically at the end
# nginx serves from $REMOTE_PATH/current, so the switch is zero-downtime and
# a bad deploy is a one-command rollback (see deploy/rollback.sh).
#
# Usage:
#   VANSPACE_DEPLOY_HOST=user@your-server.example \
#   VANSPACE_DEPLOY_PATH=/var/www/vanspace3d \
#     ./deploy/deploy.sh
#
# Requires: SSH key access to the host already set up (no password prompt).
# First time on a fresh server, also set up deploy/nginx.conf (see that
# file's header comment) so the webroot is actually served.

set -euo pipefail

HOST="${VANSPACE_DEPLOY_HOST:?Set VANSPACE_DEPLOY_HOST, e.g. user@your-server.example}"
REMOTE_PATH="${VANSPACE_DEPLOY_PATH:?Set VANSPACE_DEPLOY_PATH, e.g. /var/www/vanspace3d}"
KEEP_RELEASES="${VANSPACE_KEEP_RELEASES:-5}"

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_PATH="$REMOTE_PATH/releases/$TIMESTAMP"

cd "$(dirname "$0")/../prototype"

echo "Installing dependencies..."
npm ci

echo "Building..."
npm run build

echo "Creating release dir $RELEASE_PATH ..."
ssh "$HOST" "mkdir -p '$RELEASE_PATH'"

echo "Syncing dist/ to $HOST:$RELEASE_PATH ..."
rsync -avz --delete dist/ "$HOST:$RELEASE_PATH/"

echo "Flipping current -> releases/$TIMESTAMP ..."
ssh "$HOST" "ln -sfn '$RELEASE_PATH' '$REMOTE_PATH/current'"

echo "Pruning old releases (keeping last $KEEP_RELEASES) ..."
ssh "$HOST" "cd '$REMOTE_PATH/releases' && ls -1t | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf --"

echo "Done. Live release: $TIMESTAMP"
