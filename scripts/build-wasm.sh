#!/bin/bash
set -e

# Use full PATH including user bin directories
export PATH="/home/coder/.nvm/versions/node/v22.19.0/bin:/home/coder/.autojump/bin:/home/coder/.bun/bin:/home/coder/tools/google-cloud-sdk/bin:/home/coder/go/bin:~/bin:~/.local/bin:/home/linuxbrew/.linuxbrew/bin:/tmp/coder-script-data/bin:/home/coder/go/bin:/usr/local/nvm/versions/node/v22.19.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/go/bin:/home/coder/.yarn/bin:/home/coder/bin:/usr/local/go/bin:/usr/local/nvm/versions/node/v22.19.0/bin"

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

# Initialize/update submodule
if [ ! -d "ghostty/.git" ]; then
    echo "📦 Initializing Ghostty submodule..."
    git submodule update --init --recursive
else
    echo "📦 Ghostty submodule already initialized"
fi

# Apply patch
echo "🔧 Applying WASM API patch..."
cd ghostty
git apply --check ../patches/ghostty-wasm-api.patch || {
    echo "❌ Patch doesn't apply cleanly"
    echo "Ghostty may have changed. Check patches/ghostty-wasm-api.patch"
    exit 1
}
git apply ../patches/ghostty-wasm-api.patch

# Build WASM
echo "⚙️  Building WASM (takes ~20 seconds)..."
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall

# Copy to project root
cd ..
cp ghostty/zig-out/bin/ghostty-vt.wasm ./

# Revert patch to keep submodule clean
echo "🧹 Cleaning up..."
cd ghostty
git apply -R ../patches/ghostty-wasm-api.patch
# Remove new files created by the patch
rm -f include/ghostty/vt/terminal.h
rm -f src/terminal/c/terminal.zig
cd ..

SIZE=$(du -h ghostty-vt.wasm | cut -f1)
echo "✅ Built ghostty-vt.wasm ($SIZE)"
