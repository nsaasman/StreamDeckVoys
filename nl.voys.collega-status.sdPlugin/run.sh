#!/bin/bash
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Install from https://nodejs.org/"
    exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/app.js" "$@"
