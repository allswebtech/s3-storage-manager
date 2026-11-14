#!/usr/bin/env bash
# Local S3-compatible server for the integration and e2e tests (Versity Gateway, POSIX backend).
#   bash scripts/s3-server.sh start|stop|status
# Settings match test/s3-env.js and the CI service container.
set -euo pipefail

IMAGE="${S3_IMAGE:-versity/versitygw:v1.11.0}"
NAME="${S3_CONTAINER:-s3sm-vgw}"
PORT="${S3_PORT:-7070}"

case "${1:-start}" in
  start)
    if [ -n "$(docker ps -q -f "name=^${NAME}$")" ]; then
      echo "$NAME already running on port $PORT"
    else
      docker rm -f "$NAME" >/dev/null 2>&1 || true
      docker run -d --name "$NAME" -p "${PORT}:7070" \
        -e ROOT_ACCESS_KEY=testaccesskey -e ROOT_SECRET_KEY=testsecretkey123 \
        -e VGW_BACKEND=posix -e VGW_BACKEND_ARG=/srv -e VGW_CORS_ALLOW_ORIGIN='*' \
        "$IMAGE" >/dev/null
    fi
    for _ in $(seq 1 50); do
      if curl -s -o /dev/null "http://localhost:${PORT}/"; then echo "S3 server ready on http://localhost:${PORT}"; exit 0; fi
      sleep 0.2
    done
    echo "S3 server did not start" >&2
    docker logs "$NAME" >&2 || true
    exit 1
    ;;
  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "stopped $NAME"
    ;;
  status)
    docker ps -f "name=^${NAME}$"
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
