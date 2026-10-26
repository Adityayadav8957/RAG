#!/bin/sh
# Container entrypoint. SERVICE=api (default) | mcp
set -eu
PORT="${PORT:-8000}"
case "${SERVICE:-api}" in
  api)
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      alembic upgrade head
    fi
    exec uvicorn --factory app.main:create_app --host 0.0.0.0 --port "$PORT" \
      --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 75
    ;;
  mcp)
    exec uvicorn jira_mcp.server:app --host 0.0.0.0 --port "$PORT" --proxy-headers
    ;;
  *)
    echo "Unknown SERVICE" >&2; exit 64 ;;
esac
