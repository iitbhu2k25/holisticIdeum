#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_DIR="$SCRIPT_DIR/backend/media"

echo "=== Loading seed data ==="
python "$MEDIA_DIR/dashboard_run_all.py"
python "$MEDIA_DIR/run_all.py"

echo "=== Pushing layers to geoserver ==="
docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T backend bash -c "
    cd script &&
    python push_to_geoserver.py
"

echo "All tasks completed successfully."
