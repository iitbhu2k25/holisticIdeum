#!/bin/bash
# Start the full stack: database, redis, geoserver, backend (docker) + frontend (local).
#
#   ./start.sh            start everything (frontend in dev mode)
#   ./start.sh --seed     also load CSV seed data into postgres and push layers to geoserver
#   ./start.sh --prod     build and run the frontend with `next start` instead of `next dev`
#   ./start.sh --no-front only start the docker services
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SEED=false
PROD=false
FRONT=true
for arg in "$@"; do
    case "$arg" in
        --seed) SEED=true ;;
        --prod) PROD=true ;;
        --no-front) FRONT=false ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

wait_for() {  # wait_for <name> <url>
    echo -n "Waiting for $1 "
    for _ in $(seq 1 90); do
        if curl -s -o /dev/null "$2"; then echo " ready"; return 0; fi
        echo -n "."; sleep 2
    done
    echo " timed out ($2)"; exit 1
}

echo "Starting docker services..."
docker compose up -d --build

wait_for "geoserver" "http://localhost:9090/geoserver/web/"
wait_for "backend" "http://localhost:9000/docs"

if $SEED; then
    echo "Loading seed data into postgres..."
    python3 backend/media/run.py
    python3 backend/media/dashboard_run_all.py
    python3 backend/media/run_all.py
    python3 backend/media/gwa_data/run.py

    echo "Pushing layers to geoserver..."
    docker compose exec backend python script/push_to_geoserver.py
fi

if $FRONT; then
    cd "$ROOT/frontend"
    [ -d node_modules ] || npm install
    if $PROD; then
        npm run build
        exec npm run start
    else
        exec npm run dev
    fi
fi

echo "Backend:   http://localhost:9000/docs"
echo "GeoServer: http://localhost:9090/geoserver"
