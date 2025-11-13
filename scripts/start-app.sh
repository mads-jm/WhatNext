#!/usr/bin/env bash
# Start the Electron app in development mode
#
# args : service address (default localhost:4200), app-port (default 5173)
# args unused atm - reserved for future service integration
set -e  # Exit on error

# Store args for future use (not currently passed to npm)
SERVICE_ADDRESS=${1:-http://localhost:4200}
APP_PORT=${2:-5173}

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$PROJECT_ROOT/app"

# Verify we're in the right place
if [[ ! -f "$APP_DIR/package.json" ]]; then
    echo "❌ Error: Cannot find app/package.json"
    echo "   Expected path: $APP_DIR/package.json"
    exit 1
fi

# Check if node_modules exists
if [[ ! -d "$APP_DIR/node_modules" ]]; then
    echo "⚠️  node_modules not found. Run ./scripts/dev-init.sh first or:"
    echo "   cd app && npm install"
    exit 1
fi

# Check for required Electron dependencies on Linux
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "🐧 Detected Linux - checking Electron dependencies..."

    # Common missing dependencies on Arch/Linux
    missing_deps=()

    # Check for GTK and other common Electron requirements
    if ! ldconfig -p | grep -q libgtk-3; then
        missing_deps+=("gtk3")
    fi
    if ! ldconfig -p | grep -q libnss3; then
        missing_deps+=("nss")
    fi
    if ! ldconfig -p | grep -q libasound; then
        missing_deps+=("alsa-lib")
    fi

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        echo "⚠️  Warning: Some Electron dependencies may be missing:"
        printf '   - %s\n' "${missing_deps[@]}"
        echo ""
        echo "   On Arch Linux, install with:"
        echo "   sudo pacman -S gtk3 nss alsa-lib"
        echo ""
        echo "   Continuing anyway... (Electron may not display)"
        echo ""
    fi
fi

cd "$APP_DIR"

echo "🚀 Starting WhatNext in development mode..."
echo "   Vite dev server will be on http://localhost:1313"
echo "   Press Ctrl+C to stop all processes"
echo ""

# Run dev script without extra arguments
# Note: SERVICE_ADDRESS and APP_PORT are reserved for future use
npm run dev