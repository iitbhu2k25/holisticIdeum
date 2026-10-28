#!/bin/sh
# Keeps frontend/tunnel.json in sync with the Cloudflare quick-tunnel URL.
# Run by the tunnel_url service in docker-compose.yml or directly on the host.

if [ -d "/repo" ]; then
    REPO=/repo
else
    REPO="$(cd "$(dirname "$0")" && pwd)"
fi

FILE="$REPO/frontend/tunnel.json"
INTERVAL=${INTERVAL:-10}
OWNER=${LOG_OWNER:-1000:1000}

cd "$REPO" || exit 1

if [ -d ".git" ]; then
    git config --global --add safe.directory "$REPO" 2>/dev/null || true
    git config --global user.name "${GIT_AUTHOR_NAME:-tunnel-url-bot}" 2>/dev/null || true
    git config --global user.email "${GIT_AUTHOR_EMAIL:-tunnel-url-bot@users.noreply.github.com}" 2>/dev/null || true
fi

# Detect compose project name, fallback to holisticideum
PROJECT=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$(hostname)" 2>/dev/null)
if [ -z "$PROJECT" ]; then
    PROJECT=${COMPOSE_PROJECT_NAME:-holisticideum}
fi

echo "tunnel_url: project=$PROJECT push=$([ -n "$GITHUB_TOKEN" ] && echo on || echo off)"

push() {
    [ ! -d ".git" ] && return 0
    git add "$FILE"
    git commit -q -m "Update tunnel URL to $1" -- "$FILE" || return 0
    chown -R "$OWNER" .git 2>/dev/null || true
    remote=$(git remote get-url origin 2>/dev/null | sed -E 's#^(https://|git@)github.com[:/]##; s#\.git$##')
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -n "$remote" ] && [ -n "$branch" ] && git push -q "https://x-access-token:$GITHUB_TOKEN@github.com/$remote.git" "HEAD:$branch"; then
        git fetch -q origin "$branch" 2>/dev/null
        chown -R "$OWNER" .git 2>/dev/null || true
        echo "tunnel_url: pushed to $branch; redeploy triggered"
    else
        echo "tunnel_url: push failed (branch behind origin?); run 'git pull --rebase && git push' on the host"
    fi
}

while true; do
    cid=$(docker ps -q \
        --filter "label=com.docker.compose.project=$PROJECT" \
        --filter "label=com.docker.compose.service=cloudflared" | head -n1)

    url=""
    if [ -n "$cid" ]; then
        url=$(docker logs "$cid" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
    fi

    if [ -n "$url" ] && ! grep -q "\"$url\"" "$FILE" 2>/dev/null; then
        echo "tunnel_url: new URL $url"
        printf '{\n  "API_URL": "%s",\n  "GEOSERVER_URL": "%s"\n}\n' "$url" "$url" > "$FILE"
        chown "$OWNER" "$FILE" 2>/dev/null || true
        [ -n "$GITHUB_TOKEN" ] && push "$url"
    fi
    sleep "$INTERVAL"
done

