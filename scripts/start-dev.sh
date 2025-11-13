#!/usr/bin/env bash
# Orchestration script to start both WhatNext Electron app and test-peer
# This makes P2P development easier by starting both processes in a single command
set -e

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$PROJECT_ROOT/app"
TEST_PEER_DIR="$PROJECT_ROOT/test-peer"

# Color codes for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored messages
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_info() { echo -e "${CYAN}ℹ️  $1${NC}"; }
print_header() { echo -e "${MAGENTA}$1${NC}"; }

# Track if we're already cleaning up to prevent recursive calls
CLEANING_UP=false

# Cleanup function to kill all child processes
cleanup() {
    # Prevent recursive cleanup calls
    if [[ "$CLEANING_UP" == "true" ]]; then
        return
    fi
    CLEANING_UP=true

    # Remove trap to prevent recursive calls
    trap - SIGINT SIGTERM

    print_header "\n\n🛑 Shutting down all processes..."

    # Kill child processes and their entire process groups
    if [[ ${#PIDS[@]} -gt 0 ]]; then
        for pid in "${PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                # Send SIGTERM to the entire process group (negative PID)
                # This kills npm, node, electron, and all child processes
                kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
            fi
        done

        # Give processes 2 seconds to shut down gracefully
        sleep 2

        # Force kill any remaining processes in the process groups
        for pid in "${PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
            fi
        done
    fi

    print_success "Shutdown complete"
    exit 0
}

# Set up trap for clean exit
trap cleanup SIGINT SIGTERM EXIT

# Banner
echo ""
print_header "╔════════════════════════════════════════════════════════════╗"
print_header "║       WhatNext Development Environment Orchestrator       ║"
print_header "╚════════════════════════════════════════════════════════════╝"
echo ""

# Parse command line arguments
START_TEST_PEER=true
START_APP=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --app-only)
            START_TEST_PEER=false
            shift
            ;;
        --test-peer-only)
            START_APP=false
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Start WhatNext Electron app and/or test-peer for P2P development"
            echo ""
            echo "Options:"
            echo "  --app-only        Start only the Electron app"
            echo "  --test-peer-only  Start only the test peer"
            echo "  --help, -h        Show this help message"
            echo ""
            echo "Default: Starts both app and test-peer"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Verify directories exist
if [[ "$START_APP" == true ]] && [[ ! -f "$APP_DIR/package.json" ]]; then
    print_error "Cannot find app/package.json"
    exit 1
fi

if [[ "$START_TEST_PEER" == true ]] && [[ ! -f "$TEST_PEER_DIR/package.json" ]]; then
    print_error "Cannot find test-peer/package.json"
    exit 1
fi

# Check dependencies
if [[ "$START_APP" == true ]] && [[ ! -d "$APP_DIR/node_modules" ]]; then
    print_warning "App dependencies not installed"
    print_info "Installing app dependencies..."
    (cd "$APP_DIR" && npm install)
fi

if [[ "$START_TEST_PEER" == true ]] && [[ ! -d "$TEST_PEER_DIR/node_modules" ]]; then
    print_warning "Test peer dependencies not installed"
    print_info "Installing test peer dependencies..."
    (cd "$TEST_PEER_DIR" && npm install)
fi

# Check for Linux Electron dependencies
if [[ "$START_APP" == true ]] && [[ "$OSTYPE" == "linux-gnu"* ]]; then
    print_info "Detected Linux - checking Electron dependencies..."

    missing_deps=()
    if ! ldconfig -p | grep -q libgtk-3 2>/dev/null; then
        missing_deps+=("gtk3")
    fi
    if ! ldconfig -p | grep -q libnss3 2>/dev/null; then
        missing_deps+=("nss")
    fi
    if ! ldconfig -p | grep -q libasound 2>/dev/null; then
        missing_deps+=("alsa-lib")
    fi

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        print_warning "Some Electron dependencies may be missing:"
        printf '   - %s\n' "${missing_deps[@]}"
        print_info "On Arch Linux: sudo pacman -S gtk3 nss alsa-lib"
        echo ""
    fi
fi

# Display what will be started
echo ""
print_header "🚀 Starting Development Environment"
echo ""

if [[ "$START_APP" == true ]]; then
    print_info "✓ WhatNext Electron App (dev mode)"
    print_info "  • Vite dev server: http://localhost:1313"
    print_info "  • Hot reload enabled"
fi

if [[ "$START_TEST_PEER" == true ]]; then
    print_info "✓ Test Peer (barebones libp2p node)"
    print_info "  • Interactive CLI for testing"
    print_info "  • Auto-discovery via mDNS"
fi

echo ""
print_info "Press Ctrl+C to stop all processes"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Function to detect and launch a new terminal
launch_in_new_terminal() {
    local title=$1
    local command=$2

    # Try to detect available terminal emulators (Arch Linux common ones)
    if command -v alacritty &> /dev/null; then
        alacritty --title "$title" -e bash -c "$command; read -p 'Press Enter to close...'" &
    elif command -v kitty &> /dev/null; then
        kitty --title "$title" bash -c "$command; read -p 'Press Enter to close...'" &
    elif command -v konsole &> /dev/null; then
        konsole --title "$title" -e bash -c "$command; read -p 'Press Enter to close...'" &
    elif command -v gnome-terminal &> /dev/null; then
        gnome-terminal --title="$title" -- bash -c "$command; read -p 'Press Enter to close...'" &
    elif command -v xterm &> /dev/null; then
        xterm -T "$title" -e bash -c "$command; read -p 'Press Enter to close...'" &
    else
        print_error "No supported terminal emulator found!"
        print_info "Install one of: alacritty, kitty, konsole, gnome-terminal, xterm"
        exit 1
    fi
}

# Start processes based on flags
PIDS=()

if [[ "$START_TEST_PEER" == true ]]; then
    print_header "📡 Starting Test Peer in new terminal..."
    echo ""

    # Launch test peer in a new terminal window
    launch_in_new_terminal "WhatNext Test Peer" "cd '$TEST_PEER_DIR' && npm start"

    print_success "Test peer launched in separate terminal window"
    print_info "Look for a new terminal window titled 'WhatNext Test Peer'"
    sleep 2
fi

if [[ "$START_APP" == true ]]; then
    print_header "🖥️  Starting Electron App..."
    echo ""

    # Start app in background with its own process group
    # This allows us to kill all child processes (npm, node, electron) cleanly
    (
        # Create new process group
        set -m
        cd "$APP_DIR"
        npm run dev 2>&1 | while IFS= read -r line; do
            # Color code based on process name in concurrently output
            if [[ $line =~ ^\[RND\] ]]; then
                echo -e "${GREEN}$line${NC}"
            elif [[ $line =~ ^\[MAIN\] ]]; then
                echo -e "${YELLOW}$line${NC}"
            elif [[ $line =~ ^\[PREL\] ]]; then
                echo -e "${CYAN}$line${NC}"
            elif [[ $line =~ ^\[UTIL\] ]]; then
                echo -e "${MAGENTA}$line${NC}"
            elif [[ $line =~ ^\[ELCT\] ]]; then
                echo -e "${BLUE}$line${NC}"
            else
                echo "$line"
            fi
        done
    ) &
    APP_PID=$!
    PIDS+=($APP_PID)
fi

# Wait for all background processes
# If any process exits, trigger cleanup
wait -n
cleanup
