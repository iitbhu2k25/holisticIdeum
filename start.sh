#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_DIR="$SCRIPT_DIR/backend/media"

echo "=== Regenerating database migrations ==="
docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T backend bash -euc '
    cd /home/app
    alembic stamp base
    find alembic/versions -maxdepth 1 -type f -name "*.py" -delete
    alembic revision --autogenerate -m "generated on start"
    alembic upgrade head
'

echo "=== Creating users from media/user/users.csv ==="
docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T backend bash -c "
    cd script &&
    python create_user.py --sync-csv
"

echo "=== Loading seed data ==="
python "$MEDIA_DIR/csv_file/dashboard_run_all.py"
python "$MEDIA_DIR/run_all.py"

echo "=== Pushing layers to geoserver ==="
docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T backend bash -c "
    cd script &&
    python push_to_geoserver.py
"

echo "All tasks completed successfully."
