#!/bin/bash
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Install from https://nodejs.org/"
    exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
if [ ! -d "node_modules/ws" ]; then
    echo "First run - installing dependencies..."
    npm install --production --no-audit --no-fund
fi
node "$SCRIPT_DIR/app.js" "$@"
