#!/usr/bin/env bash
# Roll back the live symlink to a previous release (see deploy/deploy.sh).
#
# Usage:
#   VANSPACE_DEPLOY_HOST=user@your-server.example \
#   VANSPACE_DEPLOY_PATH=/var/www/vanspace3d \
#     ./deploy/rollback.sh              # rolls back to the previous release
#
#   ... ./deploy/rollback.sh 20260805101500   # rolls back to a specific release
#
#   ... ./deploy/rollback.sh --list     # lists available releases

set -euo pipefail

HOST="${VANSPACE_DEPLOY_HOST:?Set VANSPACE_DEPLOY_HOST, e.g. user@your-server.example}"
REMOTE_PATH="${VANSPACE_DEPLOY_PATH:?Set VANSPACE_DEPLOY_PATH, e.g. /var/www/vanspace3d}"

if [[ "${1:-}" == "--list" ]]; then
    ssh "$HOST" "ls -1t '$REMOTE_PATH/releases'"
    exit 0
fi

if [[ -n "${1:-}" ]]; then
    TARGET="$1"
else
    # Current release is releases/<newest>; roll back to the one before it.
    TARGET="$(ssh "$HOST" "ls -1t '$REMOTE_PATH/releases' | sed -n 2p")"
fi

if [[ -z "$TARGET" ]]; then
    echo "No previous release found to roll back to." >&2
    exit 1
fi

TARGET_PATH="$REMOTE_PATH/releases/$TARGET"

echo "Rolling back current -> releases/$TARGET ..."
ssh "$HOST" "test -d '$TARGET_PATH' && ln -sfn '$TARGET_PATH' '$REMOTE_PATH/current'"

echo "Done. Live release: $TARGET"
