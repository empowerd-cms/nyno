#!/bin/bash
# Usage: ./run.sh docker   OR   ./run.sh podman
if [ -z "$1" ]; then
    echo "Error: You must specify 'docker' or 'podman'"
    exit 1
fi

CONTAINER_TOOL=$1
IMAGE_NAME="nyno:latest"

source scripts/load-env.sh

echo "WF:$WF"
echo "GU:$GU"
echo "RB:$RB"

ENV_MOUNT_ARGS=()
if [ -f .env ]; then
  ENV_MOUNT_ARGS=(-v "$(pwd)/.env:/nyno/.env:ro")
fi


# --- Run the container ---
$CONTAINER_TOOL run -it \
-e APP_ENV=prod \
-v $(pwd)/workflows-enabled:/nyno/workflows-enabled \
-v $(pwd)/envs:/nyno/envs \
-v $(pwd)/output:/nyno/output \
-v $(pwd)/extensions:/nyno/extensions \
${ENV_MOUNT_ARGS[@]} \
-p "$PY:$PY" -p "$JS:$JS" -p "$PE:$PE" \
-p "$RB:$RB" \
-p "$WF:$WF" -p "$GU:$GU" $IMAGE_NAME bash

