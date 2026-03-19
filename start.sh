#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Install deps if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Pick a port (default 5173)
PORT=${PORT:-5173}

echo "Starting Finance Portfolio at http://localhost:$PORT"

# Open browser once the server is ready
(sleep 2 && xdg-open "http://localhost:$PORT" 2>/dev/null \
  || open "http://localhost:$PORT" 2>/dev/null \
  || echo "Open http://localhost:$PORT in your browser") &

exec npx vite --port "$PORT"
