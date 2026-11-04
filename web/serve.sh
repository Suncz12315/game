#!/usr/bin/env bash
# 本地启动静态服务器，手机与电脑连同一 Wi-Fi 即可访问。
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8080}"
IP=""
if command -v ipconfig >/dev/null 2>&1; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
elif command -v hostname >/dev/null 2>&1; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

printf '本地访问:   http://localhost:%s\n' "$PORT"
if [ -n "$IP" ]; then
  printf '局域网访问: http://%s:%s  （手机需与电脑同一 Wi-Fi）\n' "$IP" "$PORT"
fi
printf '按 Ctrl+C 停止\n\n'

exec python3 -m http.server "$PORT" --bind 0.0.0.0
