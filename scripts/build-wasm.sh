#!/bin/bash
set -e

echo "🔨 Building ghostty-vt.wasm..."

# Check for Zig
if ! command -v zig &> /dev/null; then
    echo "❌ Error: Zig not found"
    echo ""
    echo "Install Zig 0.15.2+:"
    echo "  macOS:   brew install zig"
    echo "  Linux:   https://ziglang.org/download/"
    echo ""
    exit 1
fi

ZIG_VERSION=$(zig version)
echo "✓ Found Zig $ZIG_VERSION"

# Clone/update Ghostty
GHOSTTY_DIR="/tmp/ghostty-for-wasm"
if [ ! -d "$GHOSTTY_DIR" ]; then
    echo "📦 Cloning Ghostty..."
    git clone --depth=1 https://github.com/coder/ghostty.git "$GHOSTTY_DIR"
else
    echo "📦 Updating Ghostty..."
    cd "$GHOSTTY_DIR"
    git pull --quiet
fi

# Build WASM
cd "$GHOSTTY_DIR"
echo "⚙️  Building WASM (takes ~20 seconds)..."
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall

# Copy to project root
# Get absolute path to script directory (resolve relative paths)
SCRIPT_PATH="$(readlink -f "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cp "$GHOSTTY_DIR/zig-out/bin/ghostty-vt.wasm" "$PROJECT_ROOT/"

SIZE=$(du -h "$PROJECT_ROOT/ghostty-vt.wasm" | cut -f1)
echo "✅ Built ghostty-vt.wasm ($SIZE)"
