#!/bin/bash
# Usage: ./run.sh docker   OR   ./run.sh podman

if [ -z "$1" ]; then
    echo "Error: You must specify 'docker' or 'podman'"
    exit 1
fi

CONTAINER_TOOL=$1
IMAGE_NAME="flowagi/nyno"

mkdir -p .nyno/runtime
mkdir -p output

rm .nyno/runtime/nyno-log-db.env -f

source scripts/load-env.sh

echo "Workflow Port:$WF"
echo "GUI Port:$GU"
echo "Engines:"
echo "PY:$PY"
echo "JS:$JS"
echo "PHP:$PE"
echo "RB:$RB"

ENV_MOUNT_ARGS=()
if [ -f .env ]; then
  ENV_MOUNT_ARGS=(-v "$(pwd)/.env:/nyno/.env:ro")
fi


# --- Run the container ---
$CONTAINER_TOOL run -it \
-v $(pwd)/workflows-enabled:/nyno/workflows-enabled \
-v $(pwd)/.nyno:/nyno/.nyno \
-v $(pwd)/output:/nyno/output \
-v $(pwd)/extensions:/nyno/extensions \
${ENV_MOUNT_ARGS[@]} \
-p "$PY:$PY" -p "$JS:$JS" -p "$PE:$PE" \
-p "$RB:$RB" \
-p "$WF:$WF" -p "$GU:$GU" $IMAGE_NAME bash

